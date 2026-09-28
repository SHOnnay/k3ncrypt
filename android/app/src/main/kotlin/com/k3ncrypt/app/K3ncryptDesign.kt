package com.k3ncrypt.app

import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val SlateLight = lightColorScheme(
    primary = Color(0xFF2F5D8A), onPrimary = Color.White,
    secondary = Color(0xFF254A6E), onSecondary = Color.White,
    tertiary = Color(0xFF2F8F5B), onTertiary = Color.White,
    background = Color(0xFFF1EFEA), onBackground = Color(0xFF1B1F24),
    surface = Color(0xFFF8F7F3), onSurface = Color(0xFF1B1F24),
    surfaceVariant = Color(0xFFEDEBE4), onSurfaceVariant = Color(0xFF4B5158),
    outline = Color(0xFFE1DED4), error = Color(0xFFC1473A),
)

private val SlateDark = darkColorScheme(
    primary = Color(0xFF5B9BD9), onPrimary = Color(0xFF0E1216),
    secondary = Color(0xFF7FB2E6), onSecondary = Color(0xFF0E1216),
    tertiary = Color(0xFF5BC48A), onTertiary = Color(0xFF0E1216),
    background = Color(0xFF0E1216), onBackground = Color(0xFFEDEFF2),
    surface = Color(0xFF151A20), onSurface = Color(0xFFEDEFF2),
    surfaceVariant = Color(0xFF1E252D), onSurfaceVariant = Color(0xFFB7BFC9),
    outline = Color(0xFF262E37), error = Color(0xFFE0685A),
)

private val SlateTypography = Typography().copy(
    displayLarge = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 34.sp, lineHeight = 40.sp, letterSpacing = (-0.6).sp),
    headlineLarge = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 29.sp, lineHeight = 36.sp, letterSpacing = (-0.4).sp),
    headlineMedium = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 25.sp, lineHeight = 32.sp, letterSpacing = (-0.3).sp),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 27.sp),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 21.sp),
    labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 18.sp),
    labelSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.1.sp),
)

object K3ncryptMotion {
    const val fast = 120
    const val normal = 240
    const val slow = 400
}

fun k3ncryptContactName(label: String?): String = when (label?.trim()?.lowercase()) {
    null, "", "private contact", "trusted contact", "new contact", "private conversation", "conversation" -> "Contact"
    else -> label.trim()
}

@Composable
fun K3ncryptTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) SlateDark else SlateLight,
        typography = SlateTypography,
        shapes = androidx.compose.material3.Shapes(
            extraSmall = RoundedCornerShape(8.dp),
            small = RoundedCornerShape(12.dp),
            medium = RoundedCornerShape(16.dp),
            large = RoundedCornerShape(22.dp),
            extraLarge = RoundedCornerShape(28.dp),
        ),
        content = content,
    )
}

@Composable
fun K3ncryptTopBar(title: String, subtitle: String, action: (@Composable () -> Unit)? = null) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp).padding(horizontal = 18.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier.size(38.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(13.dp)),
                contentAlignment = Alignment.Center,
            ) { Image(painter = painterResource(R.drawable.k3ncrypt_cluster_white), contentDescription = null, modifier = Modifier.size(25.dp), contentScale = ContentScale.Fit) }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(title, style = MaterialTheme.typography.titleLarge)
                Text(subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (action != null) action() else Spacer(Modifier.size(4.dp))
        }
    }
}

@Composable
fun K3ncryptBrandMark() {
    Box(
        modifier = Modifier.size(54.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(18.dp)),
        contentAlignment = Alignment.Center,
    ) { Image(painter = painterResource(R.drawable.k3ncrypt_cluster_white), contentDescription = null, modifier = Modifier.size(36.dp), contentScale = ContentScale.Fit) }
}

@Composable
fun K3ncryptSectionTitle(kicker: String, title: String, description: String? = null) {
    Column(modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(kicker.uppercase(), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
        Text(title, style = MaterialTheme.typography.headlineMedium)
        if (description != null) Text(description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun K3ncryptCard(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().animateContentSize(animationSpec = tween(durationMillis = K3ncryptMotion.normal)),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.42f)),
        tonalElevation = 1.dp,
        shadowElevation = 1.dp,
        content = content,
    )
}

@Composable
fun K3ncryptStatus(text: String, positive: Boolean = false) {
    val tint = if (positive) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary
    Row(
        modifier = Modifier.background(tint.copy(alpha = 0.10f), RoundedCornerShape(999.dp)).padding(horizontal = 11.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.size(7.dp).background(tint, RoundedCornerShape(999.dp)))
        Text(text, color = tint, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
    }
}

enum class K3ncryptNoticeTone { Neutral, Positive, Attention, Error }

fun k3ncryptNoticeToneFor(message: String): K3ncryptNoticeTone = when {
    listOf("failed", "rejected", "could not", "invalid", "unavailable", "denied").any { message.contains(it, ignoreCase = true) } -> K3ncryptNoticeTone.Error
    listOf("verified", "established", "accepted", "delivered", "restored").any { message.contains(it, ignoreCase = true) } -> K3ncryptNoticeTone.Positive
    listOf("waiting", "required", "retry", "security update").any { message.contains(it, ignoreCase = true) } -> K3ncryptNoticeTone.Attention
    else -> K3ncryptNoticeTone.Neutral
}

@Composable
fun K3ncryptNotice(text: String, tone: K3ncryptNoticeTone = K3ncryptNoticeTone.Neutral) {
    val accent = when (tone) {
        K3ncryptNoticeTone.Positive -> MaterialTheme.colorScheme.tertiary
        K3ncryptNoticeTone.Attention -> MaterialTheme.colorScheme.secondary
        K3ncryptNoticeTone.Error -> MaterialTheme.colorScheme.error
        K3ncryptNoticeTone.Neutral -> MaterialTheme.colorScheme.primary
    }
    Surface(
        modifier = Modifier.fillMaxWidth().animateContentSize(animationSpec = tween(durationMillis = K3ncryptMotion.fast)),
        shape = RoundedCornerShape(14.dp),
        color = accent.copy(alpha = 0.08f),
        border = BorderStroke(1.dp, accent.copy(alpha = 0.22f)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.size(8.dp).background(accent, RoundedCornerShape(50)))
            Text(text, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun K3ncryptEmptyState(title: String, description: String) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        K3ncryptBrandMark()
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
}
