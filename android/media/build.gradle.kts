plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }
android { namespace = "com.k3ncrypt.media"; compileSdk = 35; compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }; defaultConfig { minSdk = 26 } }
dependencies { implementation(project(":core")); implementation(project(":security")); testImplementation("junit:junit:4.13.2") }
