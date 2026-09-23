plugins { id("com.android.library"); id("org.jetbrains.kotlin.android"); id("com.google.devtools.ksp") }
android { namespace = "com.k3ncrypt.storage"; compileSdk = 35; compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }; defaultConfig { minSdk = 26; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" } }
ksp { arg("room.schemaLocation", "$projectDir/schemas") }
dependencies {
    implementation(project(":core")); implementation("androidx.room:room-runtime:2.6.1"); implementation("androidx.room:room-ktx:2.6.1"); ksp("androidx.room:room-compiler:2.6.1"); implementation("androidx.security:security-crypto:1.1.0-alpha06"); implementation("androidx.work:work-runtime-ktx:2.9.1"); testImplementation("junit:junit:4.13.2"); androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
