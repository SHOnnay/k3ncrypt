package com.k3ncrypt.app

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import org.junit.Assert.*
import org.junit.Test

class ContactVerificationAuthorityTest {
    private class Records : ContactVerificationRecords {
        val values = mutableMapOf<String, ByteArray>()
        var writes = 0
        override suspend fun read(contactId: String) = values[contactId]?.copyOf()
        override suspend fun write(contactId: String, bytes: ByteArray) { values[contactId] = bytes.copyOf(); writes++ }
    }
    private val a = "K3 " + "A".repeat(64)
    private val b = "K3 " + "B".repeat(64)
    private val contact = "stable-conversation"
    @Test fun freshPinAndMissingRecordNeverVerify() = runBlocking {
        val records = Records(); val authority = ContactVerificationAuthority(records)
        assertEquals(ContactVerificationState.UNVERIFIED, authority.state(contact, a))
        authority.observeIdentity(contact, a)
        assertEquals(ContactVerificationState.UNVERIFIED, authority.state(contact, a))
    }
    @Test fun explicitDecisionAndResetSurviveRestart() = runBlocking {
        val records = Records(); val authority = ContactVerificationAuthority(records)
        authority.observeIdentity(contact, a); authority.markVerified(contact, a, a)
        val restarted = ContactVerificationAuthority(records)
        assertEquals(ContactVerificationState.VERIFIED, restarted.state(contact, a))
        restarted.markUnverified(contact)
        assertEquals(ContactVerificationState.UNVERIFIED, ContactVerificationAuthority(records).state(contact, a))
    }
    @Test fun identityChangeIsStickyAndPersistsUntilExactReverification() = runBlocking {
        val records = Records(); val authority = ContactVerificationAuthority(records)
        authority.observeIdentity(contact, a); authority.markVerified(contact, a, a)
        authority.observeIdentity(contact, b)
        val restarted = ContactVerificationAuthority(records)
        assertEquals(ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW, restarted.state(contact, b))
        assertEquals(ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW, restarted.state(contact, a))
        restarted.markUnverified(contact)
        assertEquals(ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW, restarted.state(contact, b))
        restarted.markVerified(contact, b, b)
        assertEquals(ContactVerificationState.VERIFIED, restarted.state(contact, b))
        assertEquals(ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW, restarted.state(contact, a))
    }
    @Test fun routesAreNotAuthorityAndContactIdsRemainIsolated() = runBlocking {
        val records = Records(); val authority = ContactVerificationAuthority(records)
        authority.observeIdentity(contact, a); authority.markVerified(contact, a, a)
        // The API intentionally has no routing/network argument.
        authority.observeIdentity(contact, a)
        assertEquals(ContactVerificationState.VERIFIED, authority.state(contact, a))
        assertEquals(ContactVerificationState.UNVERIFIED, authority.state("another-conversation", a))
    }
    @Test fun unknownCorruptAndFutureRecordsFailClosed() = runBlocking {
        val records = Records(); val authority = ContactVerificationAuthority(records)
        assertEquals(ContactVerificationState.UNKNOWN, authority.state(contact, ""))
        assertEquals(ContactVerificationState.UNKNOWN, authority.state("", a))
        records.values[contact] = byteArrayOf(0, 0, 0, 2)
        assertEquals(ContactVerificationState.UNKNOWN, authority.state(contact, a))
        try { authority.markVerified(contact, a, a); fail("Corrupt state must not be replaced by verification") } catch (_: Exception) { }
    }
    @Test fun comparisonMismatchAndConcurrentChangeCannotVerifyOldIdentity() = runBlocking {
        val records = Records(); val authority = ContactVerificationAuthority(records)
        authority.observeIdentity(contact, a)
        try { authority.markVerified(contact, a, b); fail("Mismatched comparison") } catch (_: IllegalArgumentException) { }
        val changed = async { authority.observeIdentity(contact, b) }; changed.await()
        val stale = async { runCatching { authority.markVerified(contact, a, a) } }; assertTrue(stale.await().isFailure)
        assertEquals(ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW, authority.state(contact, b))
    }
    @Test fun outgoingAndIncomingGatesRejectEveryNonVerifiedStateWithoutWrites() = runBlocking {
        val records = Records(); val authority = ContactVerificationAuthority(records)
        authority.observeIdentity(contact, a)
        val before = records.writes
        for (state in ContactVerificationState.entries) {
            for (path in listOf("outgoing", "incoming remote verified=true", "matching remote fingerprint")) {
                val result = runCatching { requireVerifiedCallContact(state) }
                assertEquals(path, state == ContactVerificationState.VERIFIED, result.isSuccess)
            }
        }
        requireVerifiedCallContact(ContactVerificationState.VERIFIED)
        assertEquals(before, records.writes)
        assertEquals(ContactVerificationState.UNVERIFIED, authority.state(contact, a))
    }
    @Test fun visibilitySeparatesPinFromAllVerificationStates() {
        for (state in ContactVerificationState.entries) {
            val value = deriveAndroidSecurityVisibility("route", a, true, state)
            assertEquals(AndroidIdentityBinding.PINNED, value.identityBinding)
            assertEquals(state, value.verificationState)
            assertEquals(state == ContactVerificationState.VERIFIED, value.verificationRecorded)
            assertEquals(state == ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW, value.identityChangeRecorded)
        }
        assertEquals("Verified", verificationLabel(ContactVerificationState.VERIFIED))
        assertEquals("Unverified", verificationLabel(ContactVerificationState.UNVERIFIED))
        assertTrue(verificationLabel(ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW).contains("review"))
    }
    @Test fun changedLegacyPinIsRecordedInOneWriteAndSurvivesRestart() = runBlocking {
        val records = Records(); val authority = ContactVerificationAuthority(records)
        authority.observeIdentity(contact, b, previousIdentity = a)
        assertEquals(1, records.writes)
        assertEquals(ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW, ContactVerificationAuthority(records).state(contact, b))
    }
    @Test fun concurrentObservationAndVerificationCannotLeaveNewIdentityVerified() = runBlocking {
        repeat(50) {
            val records = Records(); val authority = ContactVerificationAuthority(records)
            authority.observeIdentity(contact, a)
            val verify = async { runCatching { authority.markVerified(contact, a, a) } }
            val observe = async { authority.observeIdentity(contact, b) }
            verify.await(); observe.await()
            assertEquals(ContactVerificationState.IDENTITY_CHANGED_PENDING_REVIEW, authority.state(contact, b))
        }
    }
    @Test fun storageFailureAndOversizedRecordDenyVerifiedOperations() = runBlocking {
        val failing = object : ContactVerificationRecords {
            override suspend fun read(contactId: String): ByteArray? = error("Storage unavailable")
            override suspend fun write(contactId: String, bytes: ByteArray) = error("Storage unavailable")
        }
        assertEquals(ContactVerificationState.UNKNOWN, ContactVerificationAuthority(failing).state(contact, a))
        val records = Records(); records.values[contact] = ByteArray(2048)
        assertEquals(ContactVerificationState.UNKNOWN, ContactVerificationAuthority(records).state(contact, a))
    }
    @Test fun actualAuthorityGateOnlyReachesFlowAfterExplicitDecision() = runBlocking {
        val records = Records(); val authority = ContactVerificationAuthority(records)
        var reachedFlow = 0
        suspend fun startExistingFlow() { requireVerifiedCallContact(authority.state(contact, a)); reachedFlow++ }
        assertTrue(runCatching { startExistingFlow() }.isFailure)
        authority.observeIdentity(contact, a)
        assertTrue(runCatching { startExistingFlow() }.isFailure)
        authority.markVerified(contact, a, a)
        val before = records.writes
        startExistingFlow()
        assertEquals(1, reachedFlow); assertEquals(before, records.writes)
        authority.observeIdentity(contact, b)
        assertTrue(runCatching { startExistingFlow() }.isFailure)
        assertEquals(1, reachedFlow)
    }

}
