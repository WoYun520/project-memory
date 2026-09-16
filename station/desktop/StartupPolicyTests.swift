import Foundation
@main struct StartupPolicyTests {
 static func main() {
  let start = Date(timeIntervalSince1970: 0)
  var p = StartupPolicy(began: start)
  precondition(!p.slow(at: start.addingTimeInterval(9)))
  precondition(p.slow(at: start.addingTimeInterval(10)))
  precondition(!p.expired(at: start.addingTimeInterval(15)))
  precondition(!p.expired(at: start.addingTimeInterval(89)))
  precondition(p.expired(at: start.addingTimeInterval(90)))
  precondition(p.allowRestart(at: start.addingTimeInterval(1)))
  precondition(p.allowRestart(at: start.addingTimeInterval(2)))
  precondition(!p.allowRestart(at: start.addingTimeInterval(3)))
  var expired = StartupPolicy(began: start)
  precondition(!expired.allowRestart(at: start.addingTimeInterval(90)))
  precondition(p.shouldWait(at: start.addingTimeInterval(7200), processRunning: true))
  precondition(!p.shouldWait(at: start.addingTimeInterval(7200), processRunning: false))
  precondition(p.delay(at: start.addingTimeInterval(7200)) == 3)
  print("Startup policy assertions passed: slow launch continues; deadline and restart limits enforced.")
 }
}
