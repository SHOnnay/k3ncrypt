plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }
val generatedJniLibs = layout.buildDirectory.dir("generated/jniLibs")
android {
    namespace = "com.k3ncrypt.crypto"
    compileSdk = 35
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    defaultConfig { minSdk = 26 }
    sourceSets.getByName("main").jniLibs.srcDir(generatedJniLibs)
}
val buildNativeCrypto = tasks.register<Exec>("buildNativeCrypto") {
    val script = file("../native-crypto/build-android.sh")
    inputs.files(fileTree("../native-crypto/src"), file("../native-crypto/Cargo.toml"), file("../native-crypto/Cargo.lock"), script)
    outputs.dir(generatedJniLibs)
    commandLine("bash", script.absolutePath, generatedJniLibs.get().asFile.absolutePath)
}
tasks.named("preBuild").configure { dependsOn(buildNativeCrypto) }
dependencies { implementation(project(":core")); testImplementation("junit:junit:4.13.2"); testImplementation("org.json:json:20240303") }
