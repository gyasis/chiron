plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.gyasi.chiron.llm"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

// litertlm-android 0.18.0 (and its kotlin-stdlib 2.4 / coroutines 1.11) carries Kotlin 2.4 metadata, but the Tauri-generated
// Android project pins the Kotlin Gradle plugin at 1.9.x and `gen/` is regenerated, so it cannot be bumped there. Kotlin 1.9
// reads these classes fine; only its metadata-version guard trips, in this module AND in the app module (the stdlib upgrade
// reaches the app's classpath). Turn the guard off for every Kotlin compile in the build. (Kotlin 2.2+ cannot be used: it
// removed the `kotlinOptions {}` DSL that every Tauri plugin's build file still uses.)
rootProject.allprojects {
    tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
        kotlinOptions.freeCompilerArgs += "-Xskip-metadata-version-check"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    // LiteRT-LM Kotlin API (Google Maven). 0.18.0 = latest on 2026-10-17; has ThinkingConfig + Channels.
    implementation("com.google.ai.edge.litertlm:litertlm-android:0.18.0")
    implementation(project(":tauri-android"))
}
