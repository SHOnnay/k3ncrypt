plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.k3ncrypt.experiment.localsession"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.k3ncrypt.experiment.localsession"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2-authenticated-experiment"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions { unitTests.isIncludeAndroidResources = false }
}

androidComponents {
    beforeVariants { variant ->
        if (variant.buildType == "release") variant.enable = false
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
