import Foundation

struct StartupPolicy {
    let began: Date
    var restarts = 0
    let timeout: TimeInterval = 90
    func expired(at now: Date) -> Bool { now.timeIntervalSince(began) >= timeout }
    func shouldWait(at now: Date, processRunning: Bool) -> Bool { processRunning || !expired(at: now) }
    func slow(at now: Date) -> Bool { now.timeIntervalSince(began) >= 10 }
    func delay(at now: Date) -> TimeInterval { expired(at: now) ? 3 : (slow(at: now) ? 1 : 0.25) }
    mutating func allowRestart(at now: Date) -> Bool {
        guard !expired(at: now), restarts < 2 else { return false }
        restarts += 1
        return true
    }
}
