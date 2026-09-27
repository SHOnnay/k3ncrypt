package com.k3ncrypt.app

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter

/** Renders the existing invitation as a QR without saving an image or changing its contents. */
@Composable
internal fun InvitationQr(invitation: String) {
    val bitmap = remember(invitation) {
        val matrix = QRCodeWriter().encode(invitation, BarcodeFormat.QR_CODE, 480, 480,
            mapOf(EncodeHintType.MARGIN to 2))
        val pixels = IntArray(matrix.width * matrix.height) { index ->
            if (matrix[index % matrix.width, index / matrix.width]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
        }
        Bitmap.createBitmap(pixels, matrix.width, matrix.height, Bitmap.Config.ARGB_8888)
    }
    Image(bitmap = bitmap.asImageBitmap(), contentDescription = "Private invitation QR code", modifier = Modifier.size(260.dp))
}
