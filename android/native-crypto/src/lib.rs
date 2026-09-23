//! Android JNI boundary for the existing Vodozemac authority.
//!
//! Kotlin receives opaque numeric handles only. Private identity keys and
//! ratchet state remain in Rust and are never serialized across JNI except as
//! encrypted account pickles or transient session-pickle bytes.

use base64::{Engine as _, engine::general_purpose::STANDARD_NO_PAD};
use jni::{
    JNIEnv,
    objects::{JByteArray, JClass, JString},
    sys::{jbyteArray, jlong, jstring},
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicI64, Ordering},
    },
};
use vodozemac::{
    Curve25519PublicKey, base64_decode, base64_encode,
    olm::{Account, AccountPickle, OlmMessage, Session, SessionConfig, SessionPickle},
};
use zeroize::Zeroize;

const PICKLE_KEY_BYTES: usize = 32;
const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const MAX_SESSION_BYTES: usize = 4 * 1024 * 1024;

static NEXT_HANDLE: AtomicI64 = AtomicI64::new(1);
static ACCOUNTS: Lazy<Mutex<HashMap<i64, Account>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static SESSIONS: Lazy<Mutex<HashMap<i64, Session>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize)]
struct PublicIdentity {
    curve25519: String,
    ed25519: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireOlmMessage {
    version: u8,
    message_type: usize,
    ciphertext: String,
}

#[derive(Serialize)]
struct InboundResult {
    #[serde(rename = "sessionHandle")]
    session_handle: i64,
    plaintext: String,
}

fn new_handle() -> i64 {
    NEXT_HANDLE.fetch_add(1, Ordering::Relaxed)
}
fn key(bytes: &[u8]) -> Result<[u8; PICKLE_KEY_BYTES], String> {
    bytes
        .try_into()
        .map_err(|_| "pickle key must be exactly 32 bytes".to_owned())
}
fn curve(value: &str) -> Result<Curve25519PublicKey, String> {
    if value.len() > 128 {
        return Err("public key input is too large".to_owned());
    }
    Curve25519PublicKey::from_base64(value).map_err(|_| "invalid Curve25519 public key".to_owned())
}
fn parse_wire(value: &str) -> Result<OlmMessage, String> {
    if value.len() > MAX_MESSAGE_BYTES * 3 {
        return Err("Olm wire message is too large".to_owned());
    }
    let wire: WireOlmMessage =
        serde_json::from_str(value).map_err(|_| "malformed Olm wire message".to_owned())?;
    if wire.version != 1 || wire.ciphertext.len() > MAX_MESSAGE_BYTES * 2 {
        return Err("unsupported or oversized Olm message".to_owned());
    }
    let ciphertext = base64_decode(wire.ciphertext)
        .map_err(|_| "malformed Olm ciphertext encoding".to_owned())?;
    if ciphertext.len() > MAX_MESSAGE_BYTES {
        return Err("Olm ciphertext is too large".to_owned());
    }
    OlmMessage::from_parts(wire.message_type, &ciphertext)
        .map_err(|_| "malformed Olm message".to_owned())
}
fn wire(message: OlmMessage) -> Result<String, String> {
    let (message_type, ciphertext) = message.to_parts();
    serde_json::to_string(&serde_json::json!({"version": 1, "message_type": message_type, "ciphertext": base64_encode(ciphertext)})).map_err(|_| "unable to encode Olm message".to_owned())
}
fn account(handle: i64) -> Result<std::sync::MutexGuard<'static, HashMap<i64, Account>>, String> {
    let guard = ACCOUNTS
        .lock()
        .map_err(|_| "account registry unavailable".to_owned())?;
    if guard.contains_key(&handle) {
        Ok(guard)
    } else {
        Err("unknown account handle".to_owned())
    }
}
fn session(handle: i64) -> Result<std::sync::MutexGuard<'static, HashMap<i64, Session>>, String> {
    let guard = SESSIONS
        .lock()
        .map_err(|_| "session registry unavailable".to_owned())?;
    if guard.contains_key(&handle) {
        Ok(guard)
    } else {
        Err("unknown session handle".to_owned())
    }
}
fn string(env: &mut JNIEnv, value: JString) -> Result<String, String> {
    env.get_string(&value)
        .map(|s| s.into())
        .map_err(|_| "invalid UTF-8 JNI string".to_owned())
}
fn bytes(env: &mut JNIEnv, value: JByteArray) -> Result<Vec<u8>, String> {
    env.convert_byte_array(value)
        .map_err(|_| "invalid JNI byte array".to_owned())
}
fn java_string(env: &mut JNIEnv, value: Result<String, String>) -> jstring {
    match value.and_then(|text| {
        env.new_string(text)
            .map_err(|_| "unable to allocate JNI string".to_owned())
    }) {
        Ok(value) => value.into_raw(),
        Err(error) => {
            let _ = env.throw_new("java/lang/IllegalStateException", error);
            std::ptr::null_mut()
        }
    }
}
fn java_long(env: &mut JNIEnv, value: Result<i64, String>) -> jlong {
    match value {
        Ok(value) => value,
        Err(error) => {
            let _ = env.throw_new("java/lang/IllegalStateException", error);
            0
        }
    }
}
fn java_bytes(env: &mut JNIEnv, value: Result<Vec<u8>, String>) -> jbyteArray {
    match value.and_then(|value| {
        env.byte_array_from_slice(&value)
            .map_err(|_| "unable to allocate JNI byte array".to_owned())
    }) {
        Ok(value) => value.into_raw(),
        Err(error) => {
            let _ = env.throw_new("java/lang/IllegalStateException", error);
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeCreateAccount(
    mut env: JNIEnv,
    _: JClass,
) -> jlong {
    let result = (|| -> Result<i64, String> {
        let id = new_handle();
        ACCOUNTS
            .lock()
            .map_err(|_| "account registry unavailable".to_owned())
            .map(|mut accounts| {
                accounts.insert(id, Account::new());
                id
            })
    })();
    java_long(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeLoadAccount(
    mut env: JNIEnv,
    _: JClass,
    pickle: JString,
    pickle_key: JByteArray,
) -> jlong {
    let result = (|| {
        let pickle = string(&mut env, pickle)?;
        if pickle.len() > 1024 * 1024 {
            return Err("account pickle is too large".to_owned());
        };
        let mut key = key(&bytes(&mut env, pickle_key)?)?;
        let result = AccountPickle::from_encrypted(&pickle, &key)
            .map(Account::from)
            .map_err(|_| "unable to authenticate or restore account pickle".to_owned());
        key.zeroize();
        let account = result?;
        let id = new_handle();
        ACCOUNTS
            .lock()
            .map_err(|_| "account registry unavailable".to_owned())?
            .insert(id, account);
        Ok(id)
    })();
    java_long(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeSaveAccount(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
    pickle_key: JByteArray,
) -> jstring {
    let result = (|| {
        let mut key = key(&bytes(&mut env, pickle_key)?)?;
        let result = account(handle)?
            .get(&handle)
            .ok_or_else(|| "unknown account handle".to_owned())
            .map(|value| value.pickle().encrypt(&key));
        key.zeroize();
        result
    })();
    java_string(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeIdentityKeys(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
) -> jstring {
    let result = (|| {
        account(handle)?
            .get(&handle)
            .ok_or_else(|| "unknown account handle".to_owned())
            .and_then(|value| {
                serde_json::to_string(&PublicIdentity {
                    curve25519: value.curve25519_key().to_base64(),
                    ed25519: value.ed25519_key().to_base64(),
                })
                .map_err(|_| "unable to encode identity".to_owned())
            })
    })();
    java_string(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeSignControlEvent(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
    payload: JByteArray,
) -> jstring {
    let result = (|| {
        let payload = bytes(&mut env, payload)?;
        if payload.is_empty() || payload.len() > 16 * 1024 {
            return Err("control event is invalid or too large".to_owned());
        };
        account(handle)?
            .get(&handle)
            .ok_or_else(|| "unknown account handle".to_owned())
            .map(|value| value.sign(&payload).to_base64())
    })();
    java_string(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeGenerateOneTimeKeys(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
    count: i32,
) {
    if let Err(error) = (|| {
        if !(1..=100).contains(&count) {
            return Err("one-time key count must be between 1 and 100".to_owned());
        };
        account(handle)?
            .get_mut(&handle)
            .ok_or_else(|| "unknown account handle".to_owned())?
            .generate_one_time_keys(count as usize);
        Ok(())
    })() {
        let _ = env.throw_new("java/lang/IllegalStateException", error);
    }
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeOneTimeKeys(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
) -> jstring {
    let result = (|| {
        account(handle)?
            .get(&handle)
            .ok_or_else(|| "unknown account handle".to_owned())
            .and_then(|value| {
                serde_json::to_string(
                    &value
                        .one_time_keys()
                        .values()
                        .map(Curve25519PublicKey::to_base64)
                        .collect::<Vec<_>>(),
                )
                .map_err(|_| "unable to encode keys".to_owned())
            })
    })();
    java_string(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeGenerateFallbackKey(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
) {
    if let Err(error) = account(handle).and_then(|mut values| {
        values
            .get_mut(&handle)
            .ok_or_else(|| "unknown account handle".to_owned())
            .map(|value| value.generate_fallback_key())
    }) {
        let _ = env.throw_new("java/lang/IllegalStateException", error);
    }
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeFallbackKey(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
) -> jstring {
    let result = (|| {
        account(handle)?
            .get(&handle)
            .ok_or_else(|| "unknown account handle".to_owned())
            .and_then(|value| {
                value
                    .fallback_key()
                    .values()
                    .next()
                    .map(Curve25519PublicKey::to_base64)
                    .ok_or_else(|| "no fallback key is available".to_owned())
            })
    })();
    java_string(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeMarkKeysAsPublished(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
) {
    if let Err(error) = account(handle).and_then(|mut values| {
        values
            .get_mut(&handle)
            .ok_or_else(|| "unknown account handle".to_owned())
            .map(|value| value.mark_keys_as_published())
    }) {
        let _ = env.throw_new("java/lang/IllegalStateException", error);
    }
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeCreateOutboundSession(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
    identity: JString,
    prekey: JString,
) -> jlong {
    let result = (|| {
        let identity = string(&mut env, identity)?;
        let prekey = string(&mut env, prekey)?;
        let session = account(handle)?
            .get(&handle)
            .ok_or_else(|| "unknown account handle".to_owned())?
            .create_outbound_session(
                SessionConfig::version_1(),
                curve(&identity)?,
                curve(&prekey)?,
            )
            .map_err(|_| "unable to create outbound session".to_owned())?;
        let id = new_handle();
        SESSIONS
            .lock()
            .map_err(|_| "session registry unavailable".to_owned())?
            .insert(id, session);
        Ok(id)
    })();
    java_long(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeCreateInboundSession(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
    identity: JString,
    message: JString,
) -> jstring {
    let result = (|| {
        let identity = string(&mut env, identity)?;
        let message = parse_wire(&string(&mut env, message)?)?;
        let prekey = match message {
            OlmMessage::PreKey(value) => value,
            OlmMessage::Normal(_) => {
                return Err("inbound session requires a pre-key message".to_owned());
            }
        };
        let result = account(handle)?
            .get_mut(&handle)
            .ok_or_else(|| "unknown account handle".to_owned())?
            .create_inbound_session(SessionConfig::version_1(), curve(&identity)?, &prekey)
            .map_err(|_| "unable to authenticate or create inbound session".to_owned())?;
        let id = new_handle();
        SESSIONS
            .lock()
            .map_err(|_| "session registry unavailable".to_owned())?
            .insert(id, result.session);
        serde_json::to_string(&InboundResult {
            session_handle: id,
            plaintext: STANDARD_NO_PAD.encode(result.plaintext),
        })
        .map_err(|_| "unable to encode inbound result".to_owned())
    })();
    java_string(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeEncrypt(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
    plaintext: JByteArray,
) -> jstring {
    let result = (|| {
        let plaintext = bytes(&mut env, plaintext)?;
        if plaintext.len() > MAX_MESSAGE_BYTES {
            return Err("Olm plaintext is too large".to_owned());
        };
        let message = session(handle)?
            .get_mut(&handle)
            .ok_or_else(|| "unknown session handle".to_owned())?
            .encrypt(&plaintext)
            .map_err(|_| "Olm encryption failed".to_owned())?;
        wire(message)
    })();
    java_string(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeDecrypt(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
    message: JString,
) -> jbyteArray {
    let result = (|| {
        let message = parse_wire(&string(&mut env, message)?)?;
        session(handle)?
            .get_mut(&handle)
            .ok_or_else(|| "unknown session handle".to_owned())?
            .decrypt(&message)
            .map_err(|_| "Olm message authentication failed".to_owned())
    })();
    java_bytes(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeSaveSession(
    mut env: JNIEnv,
    _: JClass,
    handle: jlong,
) -> jbyteArray {
    let result = (|| {
        session(handle)?
            .get(&handle)
            .ok_or_else(|| "unknown session handle".to_owned())
            .and_then(|value| {
                serde_json::to_vec(&value.pickle())
                    .map_err(|_| "unable to serialize session".to_owned())
            })
    })();
    java_bytes(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeLoadSession(
    mut env: JNIEnv,
    _: JClass,
    serialized: JByteArray,
) -> jlong {
    let result = (|| {
        let serialized = bytes(&mut env, serialized)?;
        if serialized.len() > MAX_SESSION_BYTES {
            return Err("session pickle is too large".to_owned());
        };
        let pickle: SessionPickle = serde_json::from_slice(&serialized)
            .map_err(|_| "corrupted session pickle".to_owned())?;
        let id = new_handle();
        SESSIONS
            .lock()
            .map_err(|_| "session registry unavailable".to_owned())?
            .insert(id, pickle.into());
        Ok(id)
    })();
    java_long(&mut env, result)
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeCloseAccount(
    _: JNIEnv,
    _: JClass,
    handle: jlong,
) {
    if let Ok(mut values) = ACCOUNTS.lock() {
        values.remove(&handle);
    }
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_k3ncrypt_crypto_NativeCryptoBridge_nativeCloseSession(
    _: JNIEnv,
    _: JClass,
    handle: jlong,
) {
    if let Ok(mut values) = SESSIONS.lock() {
        values.remove(&handle);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prekey_message_survives_account_restart_and_rejects_duplicate() {
        let alice = Account::new();
        let mut bob = Account::new();
        bob.generate_one_time_keys(1);
        let otk = bob.one_time_keys().values().next().unwrap().to_base64();
        let bob_key = bob.curve25519_key().to_base64();
        let mut sender = alice
            .create_outbound_session(
                SessionConfig::version_1(),
                curve(&bob_key).unwrap(),
                curve(&otk).unwrap(),
            )
            .unwrap();
        bob.mark_keys_as_published();
        let key = [9_u8; 32];
        let pickle = bob.pickle().encrypt(&key);
        let mut restored: Account = AccountPickle::from_encrypted(&pickle, &key).unwrap().into();
        let message = sender.encrypt(b"fixture").unwrap();
        let serialized = wire(message.clone()).unwrap();
        let prekey = match parse_wire(&serialized).unwrap() {
            OlmMessage::PreKey(value) => value,
            _ => panic!("expected pre-key"),
        };
        let inbound = restored
            .create_inbound_session(SessionConfig::version_1(), alice.curve25519_key(), &prekey)
            .unwrap();
        assert_eq!(inbound.plaintext, b"fixture");
        assert!(
            restored
                .create_inbound_session(SessionConfig::version_1(), alice.curve25519_key(), &prekey)
                .is_err()
        );
    }
}
