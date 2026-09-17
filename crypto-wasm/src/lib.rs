//! Narrow K3ncrypt boundary around vodozemac's high-level Olm API.
//!
//! Private identity keys never have an accessor. Accounts and sessions live
//! behind opaque Rust/WASM handles. Only public keys, encrypted account
//! pickles, encrypted messages, and transient session-pickle bytes cross the
//! boundary. Session bytes must be written immediately through SecureStorage.

use serde::{Deserialize, Serialize};
use vodozemac::{
    Curve25519PublicKey, base64_decode, base64_encode,
    olm::{Account, AccountPickle, OlmMessage, Session, SessionConfig, SessionPickle},
};
use wasm_bindgen::prelude::*;
use zeroize::Zeroize;

const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const PICKLE_KEY_BYTES: usize = 32;

#[cfg(target_arch = "wasm32")]
fn js_error(message: impl ToString) -> JsValue {
    JsValue::from_str(&message.to_string())
}

#[cfg(not(target_arch = "wasm32"))]
fn js_error(_message: impl ToString) -> JsValue {
    // Native tests assert fail-closed behavior but cannot construct a
    // JavaScript string value. WASM builds preserve the descriptive message.
    JsValue::NULL
}

fn parse_pickle_key(value: &[u8]) -> Result<[u8; PICKLE_KEY_BYTES], JsValue> {
    value
        .try_into()
        .map_err(|_| js_error("The account pickle key must be exactly 32 bytes."))
}

fn public_key(value: &str) -> Result<Curve25519PublicKey, JsValue> {
    if value.len() > 128 {
        return Err(js_error("Public key input is too large."));
    }
    Curve25519PublicKey::from_base64(value).map_err(|_| js_error("Invalid Curve25519 public key."))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicIdentity {
    pub curve25519: String,
    pub ed25519: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireOlmMessage {
    pub version: u8,
    pub message_type: usize,
    pub ciphertext: String,
}

impl WireOlmMessage {
    fn from_olm(message: OlmMessage) -> Self {
        let (message_type, ciphertext) = message.to_parts();
        Self {
            version: 1,
            message_type,
            ciphertext: base64_encode(ciphertext),
        }
    }

    fn into_olm(self) -> Result<OlmMessage, JsValue> {
        if self.version != 1 || self.ciphertext.len() > MAX_MESSAGE_BYTES * 2 {
            return Err(js_error("Unsupported or oversized Olm message."));
        }
        let ciphertext = base64_decode(self.ciphertext)
            .map_err(|_| js_error("Malformed Olm ciphertext encoding."))?;
        if ciphertext.len() > MAX_MESSAGE_BYTES {
            return Err(js_error("Olm ciphertext is too large."));
        }
        OlmMessage::from_parts(self.message_type, &ciphertext)
            .map_err(|_| js_error("Malformed Olm message."))
    }
}

fn parse_wire_message(value: &str) -> Result<OlmMessage, JsValue> {
    if value.len() > MAX_MESSAGE_BYTES * 3 {
        return Err(js_error("Olm wire message is too large."));
    }
    let wire: WireOlmMessage =
        serde_json::from_str(value).map_err(|_| js_error("Malformed Olm wire message."))?;
    wire.into_olm()
}

#[wasm_bindgen]
pub struct K3ncryptAccount {
    inner: Account,
}

#[wasm_bindgen]
impl K3ncryptAccount {
    #[wasm_bindgen(js_name = createAccount)]
    pub fn create_account() -> Self {
        Self {
            inner: Account::new(),
        }
    }

    #[wasm_bindgen(js_name = loadAccount)]
    pub fn load_account(encrypted_pickle: &str, pickle_key: &[u8]) -> Result<Self, JsValue> {
        if encrypted_pickle.len() > 1024 * 1024 {
            return Err(js_error("Account pickle is too large."));
        }
        let mut key = parse_pickle_key(pickle_key)?;
        let result = AccountPickle::from_encrypted(encrypted_pickle, &key)
            .map(|pickle| Self {
                inner: pickle.into(),
            })
            .map_err(|_| js_error("Unable to authenticate or restore the account pickle."));
        key.zeroize();
        result
    }

    #[wasm_bindgen(js_name = identityKeys)]
    pub fn identity_keys(&self) -> Result<String, JsValue> {
        serde_json::to_string(&PublicIdentity {
            curve25519: self.inner.curve25519_key().to_base64(),
            ed25519: self.inner.ed25519_key().to_base64(),
        })
        .map_err(js_error)
    }

    #[wasm_bindgen(js_name = generateOneTimeKeys)]
    pub fn generate_one_time_keys(&mut self, count: usize) -> Result<(), JsValue> {
        if count == 0 || count > 100 {
            return Err(js_error("One-time key count must be between 1 and 100."));
        }
        self.inner.generate_one_time_keys(count);
        Ok(())
    }

    #[wasm_bindgen(js_name = firstOneTimeKey)]
    pub fn first_one_time_key(&self) -> Result<String, JsValue> {
        self.inner
            .one_time_keys()
            .values()
            .next()
            .map(Curve25519PublicKey::to_base64)
            .ok_or_else(|| js_error("No one-time key is available."))
    }

    #[wasm_bindgen(js_name = generateFallbackKey)]
    pub fn generate_fallback_key(&mut self) {
        self.inner.generate_fallback_key();
    }

    #[wasm_bindgen(js_name = fallbackKey)]
    pub fn fallback_key(&self) -> Result<String, JsValue> {
        self.inner
            .fallback_key()
            .values()
            .next()
            .map(Curve25519PublicKey::to_base64)
            .ok_or_else(|| js_error("No fallback key is available."))
    }

    #[wasm_bindgen(js_name = markKeysAsPublished)]
    pub fn mark_keys_as_published(&mut self) {
        self.inner.mark_keys_as_published();
    }

    #[wasm_bindgen(js_name = saveAccount)]
    pub fn save_account(&self, pickle_key: &[u8]) -> Result<String, JsValue> {
        let mut key = parse_pickle_key(pickle_key)?;
        let result = self.inner.pickle().encrypt(&key);
        key.zeroize();
        Ok(result)
    }

    #[wasm_bindgen(js_name = createOutboundSession)]
    pub fn create_outbound_session(
        &self,
        recipient_identity_key: &str,
        recipient_one_time_key: &str,
    ) -> Result<K3ncryptSession, JsValue> {
        let session = self
            .inner
            .create_outbound_session(
                SessionConfig::version_1(),
                public_key(recipient_identity_key)?,
                public_key(recipient_one_time_key)?,
            )
            .map_err(|_| js_error("Unable to create outbound Olm session."))?;
        Ok(K3ncryptSession { inner: session })
    }

    #[wasm_bindgen(js_name = createInboundSession)]
    pub fn create_inbound_session(
        &mut self,
        sender_identity_key: &str,
        pre_key_message: &str,
    ) -> Result<InboundSessionResult, JsValue> {
        let message = parse_wire_message(pre_key_message)?;
        let pre_key = match message {
            OlmMessage::PreKey(value) => value,
            OlmMessage::Normal(_) => {
                return Err(js_error("An inbound session requires a pre-key message."));
            }
        };
        let result = self
            .inner
            .create_inbound_session(
                SessionConfig::version_1(),
                public_key(sender_identity_key)?,
                &pre_key,
            )
            .map_err(|_| js_error("Unable to authenticate or create inbound Olm session."))?;
        Ok(InboundSessionResult {
            session: Some(K3ncryptSession {
                inner: result.session,
            }),
            plaintext: result.plaintext,
        })
    }
}

#[wasm_bindgen]
pub struct InboundSessionResult {
    session: Option<K3ncryptSession>,
    plaintext: Vec<u8>,
}

#[wasm_bindgen]
impl InboundSessionResult {
    #[wasm_bindgen(js_name = takeSession)]
    pub fn take_session(&mut self) -> Result<K3ncryptSession, JsValue> {
        self.session
            .take()
            .ok_or_else(|| js_error("Inbound session handle was already consumed."))
    }

    #[wasm_bindgen(js_name = plaintext)]
    pub fn plaintext(&self) -> Vec<u8> {
        self.plaintext.clone()
    }
}

#[wasm_bindgen]
pub struct K3ncryptSession {
    inner: Session,
}

#[wasm_bindgen]
impl K3ncryptSession {
    #[wasm_bindgen(js_name = encrypt)]
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<String, JsValue> {
        if plaintext.len() > MAX_MESSAGE_BYTES {
            return Err(js_error("Olm plaintext is too large."));
        }
        let message = self
            .inner
            .encrypt(plaintext)
            .map_err(|_| js_error("Olm encryption failed."))?;
        serde_json::to_string(&WireOlmMessage::from_olm(message)).map_err(js_error)
    }

    #[wasm_bindgen(js_name = decrypt)]
    pub fn decrypt(&mut self, wire_message: &str) -> Result<Vec<u8>, JsValue> {
        let message = parse_wire_message(wire_message)?;
        self.inner
            .decrypt(&message)
            .map_err(|_| js_error("Olm message authentication failed."))
    }

    #[wasm_bindgen(js_name = sessionId)]
    pub fn session_id(&self) -> String {
        self.inner.session_id()
    }

    /// Returns a transient modern SessionPickle encoding. JavaScript must
    /// immediately pass it to K3ncrypt SecureStorage and drop the copy.
    #[wasm_bindgen(js_name = saveSession)]
    pub fn save_session(&self) -> Result<Vec<u8>, JsValue> {
        serde_json::to_vec(&self.inner.pickle()).map_err(js_error)
    }

    #[wasm_bindgen(js_name = loadSession)]
    pub fn load_session(serialized: &[u8]) -> Result<K3ncryptSession, JsValue> {
        if serialized.len() > 4 * 1024 * 1024 {
            return Err(js_error("Session pickle is too large."));
        }
        let pickle: SessionPickle = serde_json::from_slice(serialized)
            .map_err(|_| js_error("Corrupted session pickle."))?;
        Ok(K3ncryptSession {
            inner: pickle.into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn establish() -> (
        K3ncryptAccount,
        K3ncryptAccount,
        K3ncryptSession,
        K3ncryptSession,
    ) {
        let alice = K3ncryptAccount::create_account();
        let mut bob = K3ncryptAccount::create_account();
        bob.generate_one_time_keys(1).unwrap();
        bob.generate_fallback_key();
        let bob_key = bob.first_one_time_key().unwrap();
        let mut alice_session = alice
            .create_outbound_session(&bob.inner.curve25519_key().to_base64(), &bob_key)
            .unwrap();
        bob.mark_keys_as_published();
        let first = alice_session.encrypt(b"hello bob").unwrap();
        let inbound = bob
            .create_inbound_session(&alice.inner.curve25519_key().to_base64(), &first)
            .unwrap();
        assert_eq!(inbound.plaintext, b"hello bob");
        let bob_session = inbound.session.unwrap();
        (alice, bob, alice_session, bob_session)
    }

    #[test]
    fn alice_and_bob_establish_and_exchange_pre_key_and_normal_messages() {
        let (_, _, mut alice, mut bob) = establish();
        let reply = bob.encrypt(b"reply").unwrap();
        assert_eq!(alice.decrypt(&reply).unwrap(), b"reply");
        let normal = alice.encrypt(b"normal message").unwrap();
        let parsed: WireOlmMessage = serde_json::from_str(&normal).unwrap();
        assert_eq!(parsed.message_type, 1);
        assert_eq!(bob.decrypt(&normal).unwrap(), b"normal message");
    }

    #[test]
    fn accounts_and_sessions_survive_restart_without_identity_rotation() {
        let (alice, bob, mut alice_session, mut bob_session) = establish();
        let bob_reply = bob_session.encrypt(b"acknowledge").unwrap();
        assert_eq!(alice_session.decrypt(&bob_reply).unwrap(), b"acknowledge");
        let before_alice = alice.identity_keys().unwrap();
        let before_bob = bob.identity_keys().unwrap();
        let pickle_key = [7_u8; 32]; // Synthetic test-only fixture.
        let alice_account_pickle = alice.save_account(&pickle_key).unwrap();
        let bob_account_pickle = bob.save_account(&pickle_key).unwrap();
        let alice_session_pickle = alice_session.save_session().unwrap();
        let bob_session_pickle = bob_session.save_session().unwrap();
        drop((alice, bob, alice_session, bob_session));

        let alice = K3ncryptAccount::load_account(&alice_account_pickle, &pickle_key).unwrap();
        let bob = K3ncryptAccount::load_account(&bob_account_pickle, &pickle_key).unwrap();
        let mut alice_session = K3ncryptSession::load_session(&alice_session_pickle).unwrap();
        let mut bob_session = K3ncryptSession::load_session(&bob_session_pickle).unwrap();
        assert_eq!(before_alice, alice.identity_keys().unwrap());
        assert_eq!(before_bob, bob.identity_keys().unwrap());

        let after_restart = alice_session.encrypt(b"after restart").unwrap();
        assert_eq!(
            bob_session.decrypt(&after_restart).unwrap(),
            b"after restart"
        );
    }

    #[test]
    fn legitimate_messages_decrypt_out_of_order() {
        let (_, _, mut alice, mut bob) = establish();
        let reply = bob.encrypt(b"ratchet reply").unwrap();
        alice.decrypt(&reply).unwrap();
        let one = alice.encrypt(b"1").unwrap();
        let two = alice.encrypt(b"2").unwrap();
        let three = alice.encrypt(b"3").unwrap();

        assert_eq!(bob.decrypt(&one).unwrap(), b"1");
        assert_eq!(bob.decrypt(&three).unwrap(), b"3");
        assert_eq!(bob.decrypt(&two).unwrap(), b"2");
    }

    #[test]
    fn duplicate_olm_ciphertext_is_rejected_by_the_ratchet() {
        let (_, _, mut alice, mut bob) = establish();
        let reply = bob.encrypt(b"ratchet reply").unwrap();
        alice.decrypt(&reply).unwrap();
        let message = alice.encrypt(b"process once").unwrap();
        assert_eq!(bob.decrypt(&message).unwrap(), b"process once");
        assert!(bob.decrypt(&message).is_err());
    }

    #[test]
    fn malformed_wrong_identity_and_tampered_inputs_fail_closed() {
        let (alice, _, mut alice_session, mut bob_session) = establish();
        let normal = alice_session.encrypt(b"authenticated").unwrap();
        let mut wire: WireOlmMessage = serde_json::from_str(&normal).unwrap();
        wire.ciphertext.replace_range(2..3, "A");
        let tampered = serde_json::to_string(&wire).unwrap();
        assert!(bob_session.decrypt(&tampered).is_err());

        let mut mallory = K3ncryptAccount::create_account();
        let pre_key = alice_session.encrypt(b"not actually pre-key").unwrap();
        assert!(
            mallory
                .create_inbound_session(&alice.inner.curve25519_key().to_base64(), &pre_key)
                .is_err()
        );
        assert!(
            alice
                .create_outbound_session(
                    &mallory.inner.curve25519_key().to_base64(),
                    "invalid-one-time-key"
                )
                .is_err()
        );

        let initiator = K3ncryptAccount::create_account();
        let mut recipient = K3ncryptAccount::create_account();
        let impostor = K3ncryptAccount::create_account();
        recipient.generate_one_time_keys(1).unwrap();
        let mut outbound = initiator
            .create_outbound_session(
                &recipient.inner.curve25519_key().to_base64(),
                &recipient.first_one_time_key().unwrap(),
            )
            .unwrap();
        let targeted_pre_key = outbound.encrypt(b"identity bound").unwrap();
        assert!(
            recipient
                .create_inbound_session(
                    &impostor.inner.curve25519_key().to_base64(),
                    &targeted_pre_key
                )
                .is_err()
        );

        assert!(parse_wire_message(r#"{"version":2,"message_type":0,"ciphertext":"AA"}"#).is_err());
        assert!(
            parse_wire_message(r#"{"version":1,"message_type":0,"ciphertext":"***"}"#).is_err()
        );
        assert!(K3ncryptSession::load_session(b"not-json").is_err());
        assert!(K3ncryptAccount::load_account("corrupted", &[7_u8; 32]).is_err());
    }
}
