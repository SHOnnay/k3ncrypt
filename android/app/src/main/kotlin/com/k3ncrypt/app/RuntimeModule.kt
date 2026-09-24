package com.k3ncrypt.app

import android.content.Context
import androidx.room.Room
import com.k3ncrypt.crypto.CryptoPort
import com.k3ncrypt.crypto.NativeCryptoBridge
import com.k3ncrypt.network.DeviceLifecycleRequests
import com.k3ncrypt.network.DeviceProofClient
import com.k3ncrypt.network.K3ncryptApi
import com.k3ncrypt.network.SocketRelay
import com.k3ncrypt.storage.CryptoStateStore
import com.k3ncrypt.storage.EncryptedRecordStore
import com.k3ncrypt.storage.K3ncryptSecureDatabase
import com.k3ncrypt.storage.KeystoreAead
import com.k3ncrypt.storage.PickleKeyVault
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object RuntimeModule {
    @Provides @Singleton fun database(@ApplicationContext context: Context): K3ncryptSecureDatabase =
        Room.databaseBuilder(context, K3ncryptSecureDatabase::class.java, "k3ncrypt-secure.db").build()

    @Provides @Singleton fun keystoreAead() = KeystoreAead()
    @Provides @Singleton fun encryptedRecords(database: K3ncryptSecureDatabase, aead: KeystoreAead) = EncryptedRecordStore(database, aead)
    @Provides @Singleton fun cryptoState(database: K3ncryptSecureDatabase, aead: KeystoreAead) = CryptoStateStore(database, aead)
    @Provides @Singleton fun pickleKeyVault(records: EncryptedRecordStore) = PickleKeyVault(records)
    @Provides @Singleton fun cryptoPort(): CryptoPort = NativeCryptoBridge()
    @Provides @Singleton fun api(): K3ncryptApi = K3ncryptApi(BuildConfig.K3NCRYPT_BACKEND_URL)
    @Provides @Singleton fun relay(): SocketRelay = SocketRelay(BuildConfig.K3NCRYPT_SOCKET_URL)
    @Provides @Singleton fun lifecycleRequests(crypto: CryptoPort) = DeviceLifecycleRequests(crypto)
    @Provides @Singleton fun proofClient(crypto: CryptoPort, api: K3ncryptApi) = DeviceProofClient(crypto, api)
    @Provides @Singleton fun identityLifecycle(
        crypto: CryptoPort,
        store: CryptoStateStore,
        pickleKeys: PickleKeyVault,
        api: K3ncryptApi,
        requests: DeviceLifecycleRequests,
        proofs: DeviceProofClient,
    ) = AndroidIdentityLifecycleRepository(crypto, store, pickleKeys, api, requests, proofs)
    @Provides @Singleton fun messaging(
        identity: AndroidIdentityLifecycleRepository,
        crypto: CryptoPort,
        state: CryptoStateStore,
        pickleKeys: PickleKeyVault,
        api: K3ncryptApi,
        proofs: DeviceProofClient,
        relay: SocketRelay,
    ) = AndroidMessagingRepository(identity, crypto, state, pickleKeys, api, proofs, relay)
}
