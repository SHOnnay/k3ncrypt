plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }
android { namespace = "com.k3ncrypt.security"; compileSdk = 35; compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }; defaultConfig { minSdk = 26 } }
dependencies { implementation(project(":core")); implementation(project(":crypto")); testImplementation("junit:junit:4.13.2") }
