plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }
android { namespace = "com.k3ncrypt.core"; compileSdk = 35; compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }; defaultConfig { minSdk = 26 } }
dependencies { implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0"); testImplementation("junit:junit:4.13.2") }
