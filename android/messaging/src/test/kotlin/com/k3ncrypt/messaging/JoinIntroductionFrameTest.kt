package com.k3ncrypt.messaging

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class JoinIntroductionFrameTest {
    @Test fun `frame and canonical signature input match shared Web Android fixture`() {
        val fixture = sharedFixture()
        val vector = fixture.getJSONObject("signatureVector")
        val intro = fixture.getJSONObject("joinIntroduction")
        val introductionPayload = JoinIntroductionFrameBytes.fromHex(intro.getString("magicHex")) + vector.getString("eventJson").encodeToByteArray()
        val event = JoinIntroductionFrame.parse(introductionPayload)
        assertTrue(event != null)
        assertEquals(vector.getString("canonicalPayload"), JoinIntroductionFrame.canonicalPayload(event!!).decodeToString())
        assertArrayEquals(introductionPayload, JoinIntroductionFrame.encode(event))
        val outerFrame = JoinIntroductionFrameBytes.fromHex(intro.getString("messageFramePrefixHex")) + introductionPayload
        assertArrayEquals(introductionPayload, MessageFrame.decodePayload(outerFrame))
    }

    @Test fun `ordinary payload is not classified as introduction and malformed intro is rejected`() {
        assertNull(JoinIntroductionFrame.parse(byteArrayOf(1, 1, 0x41)))
        val magic = JoinIntroductionFrameBytes.fromHex(sharedFixture().getJSONObject("joinIntroduction").getString("magicHex"))
        assertThrows(IllegalArgumentException::class.java) { JoinIntroductionFrame.parse(magic + "{}".encodeToByteArray()) }
    }

    private fun sharedFixture(): JSONObject {
        var directory: File? = File(System.getProperty("user.dir") ?: ".")
        repeat(8) {
            val candidate = directory?.resolve("protocol-fixtures/v1/verification-readiness.json")
            if (candidate?.isFile == true) return JSONObject(candidate.readText())
            directory = directory?.parentFile
        }
        error("Shared verification fixture not found")
    }
}

private object JoinIntroductionFrameBytes {
    fun fromHex(hex: String): ByteArray = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
