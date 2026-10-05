package com.k3ncrypt.experiment.localsession

/** Sliding-window connection-attempt cap, separated so the controller and tests share it. */
internal class ConnectionAttemptLimiter(
    private val maxAttempts: Int = 6,
    private val windowMs: Long = 60_000L,
) {
    private val attempts = ArrayDeque<Long>()

    @Synchronized
    fun reserve(nowMs: Long): Boolean {
        while (attempts.isNotEmpty() && nowMs - attempts.first() >= windowMs) attempts.removeFirst()
        if (attempts.size >= maxAttempts) return false
        attempts.addLast(nowMs)
        return true
    }
}

/** Small synchronized FIFO with the spike's count and byte caps. */
internal class OutboundFrameQueue(private val maxFrames: Int = 8, private val maxBytes: Int = 4096) {
    private val frames = ArrayDeque<ByteArray>()
    private var bytes = 0
    @Synchronized fun offer(frame: ByteArray): Boolean {
        if (frames.size >= maxFrames || bytes + frame.size > maxBytes) return false
        frames.addLast(frame.copyOf()); bytes += frame.size
        return true
    }
    @Synchronized fun take(): ByteArray? = frames.removeFirstOrNull()?.also { bytes -= it.size }
    @Synchronized fun clear() { frames.clear(); bytes = 0 }
    @Synchronized fun size() = frames.size
}

/** Deduplicates names and enforces first-seen TTL without extending it on duplicates. */
internal class BoundedHintSet<K, V>(private val maxSize: Int = 8, private val ttlMs: Long = 30_000L) {
    private data class Item<V>(val value: V, val firstSeen: Long)
    private val values = LinkedHashMap<K, Item<V>>()
    @Synchronized fun putIfFresh(key: K, value: V, now: Long): Boolean {
        prune(now)
        if (values.containsKey(key)) return false
        if (values.size >= maxSize) return false
        values[key] = Item(value, now)
        return true
    }
    @Synchronized fun get(key: K, now: Long): V? { prune(now); return values[key]?.value }
    @Synchronized fun remove(key: K) { values.remove(key) }
    @Synchronized fun values(now: Long): List<V> { prune(now); return values.values.map { it.value } }
    @Synchronized fun clear() { values.clear() }
    @Synchronized fun size(now: Long): Int { prune(now); return values.size }
    private fun prune(now: Long) { values.entries.removeAll { now - it.value.firstSeen >= ttlMs } }
}
