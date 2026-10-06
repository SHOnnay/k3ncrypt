import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.dagger.hilt.android")
    id("com.google.devtools.ksp")
}

val configuredBackendUrl = providers.gradleProperty("k3ncryptBackendUrl").orElse("").get().trim()
val configuredSocketUrl = providers.gradleProperty("k3ncryptSocketUrl").orElse(configuredBackendUrl).get().trim()
val releaseKeystorePath = providers.environmentVariable("K3NCRYPT_ANDROID_KEYSTORE_PATH").orNull
val releaseKeystorePassword = providers.environmentVariable("K3NCRYPT_ANDROID_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("K3NCRYPT_ANDROID_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("K3NCRYPT_ANDROID_KEY_PASSWORD").orNull

android {
    namespace = "com.k3ncrypt.app"
    compileSdk = 35
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }

    defaultConfig {
        applicationId = "com.k3ncrypt.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "0.1.0-beta.3"
        buildConfigField("String", "K3NCRYPT_BACKEND_URL", "\"$configuredBackendUrl\"")
        buildConfigField("String", "K3NCRYPT_SOCKET_URL", "\"$configuredSocketUrl\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            storeFile = releaseKeystorePath?.takeIf { it.isNotBlank() }?.let(::file)
            storePassword = releaseKeystorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    implementation(project(":core"))
    implementation(project(":crypto"))
    implementation(project(":network"))
    implementation(project(":storage"))
    implementation(project(":security"))
    implementation(project(":messaging"))
    implementation(project(":media"))
    implementation(project(":calls"))
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("com.google.dagger:hilt-android:2.52")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    ksp("com.google.dagger:hilt-compiler:2.52")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:core:1.6.1")
}

val verifyReleasePackageInputs = tasks.register("verifyReleasePackageInputs") {
    group = "verification"
    description = "Fail closed unless release origins and signing credentials are configured."
    doLast {
        fun requireHttpsOrigin(name: String, value: String) {
            val uri = runCatching { URI(value) }.getOrNull()
            val host = uri?.host?.lowercase()?.removeSuffix(".")
            val placeholder = host == "localhost" || host == "example.com" || host?.endsWith(".example.com") == true ||
                host?.endsWith(".example") == true || host?.endsWith(".test") == true || host?.endsWith(".invalid") == true ||
                host == "10.0.2.2" || host == "127.0.0.1"
            require(uri != null && uri.scheme.equals("https", ignoreCase = true) && !host.isNullOrBlank() &&
                uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/") && !placeholder) {
                "$name must be configured as a real HTTPS origin before packaging a release."
            }
        }

        requireHttpsOrigin("k3ncryptBackendUrl", configuredBackendUrl)
        requireHttpsOrigin("k3ncryptSocketUrl", configuredSocketUrl)
        require(!releaseKeystorePath.isNullOrBlank() && file(releaseKeystorePath).isFile &&
            !releaseKeystorePassword.isNullOrBlank() && !releaseKeyAlias.isNullOrBlank() && !releaseKeyPassword.isNullOrBlank()) {
            "Set K3NCRYPT_ANDROID_KEYSTORE_PATH, K3NCRYPT_ANDROID_KEYSTORE_PASSWORD, K3NCRYPT_ANDROID_KEY_ALIAS, and K3NCRYPT_ANDROID_KEY_PASSWORD in the release environment."
        }
    }
}

tasks.matching { it.name in setOf("packageRelease", "bundleRelease", "signReleaseBundle") }.configureEach {
    dependsOn(verifyReleasePackageInputs)
}

// UTP may uninstall the target app after connected tests. Guard the Gradle task
// itself so direct invocation cannot target the persistent identity profile.
tasks.matching { it.name == "connectedDebugAndroidTest" }.configureEach {
    doFirst {
        val result = ProcessBuilder("bash", "${rootProject.projectDir}/scripts/verify-disposable-avd.sh")
            .inheritIO()
            .start()
            .waitFor()
        check(result == 0) { "Refusing destructive instrumentation without the disposable AVD." }
    }
}
