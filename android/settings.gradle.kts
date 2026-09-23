pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "K3NCRYPT-Android"
include(":app", ":core", ":crypto", ":network", ":storage", ":security", ":messaging", ":media", ":calls")
