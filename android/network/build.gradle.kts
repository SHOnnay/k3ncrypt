plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }
android { namespace = "com.k3ncrypt.network"; compileSdk = 35; compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }; defaultConfig { minSdk = 26 } }
dependencies {
    implementation(project(":core")); implementation(project(":crypto")); implementation(project(":security")); implementation("com.squareup.okhttp3:okhttp:4.12.0"); implementation("io.socket:socket.io-client:2.1.1") { exclude(group = "org.json", module = "json") }; implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0"); testImplementation("junit:junit:4.13.2"); testImplementation("org.json:json:20240303")
}
