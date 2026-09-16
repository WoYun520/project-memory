import Cocoa
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: 512, height: 512))
        image.lockFocus()
        NSColor(calibratedRed: 0.17, green: 0.28, blue: 0.21, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 12,y: 12,width: 488,height: 488),xRadius: 108,yRadius: 108).fill()
        NSColor(calibratedRed: 0.91,green: 0.95,blue: 0.86,alpha: 1).setFill()
        for x in [90, 280] {
            NSBezierPath(roundedRect: NSRect(x:x,y:140,width:142,height:240),xRadius:24,yRadius:24).fill()
        }
        NSColor(calibratedRed: 0.50,green: 0.66,blue: 0.47,alpha: 1).setStroke()
        for x in [114,304] { for y in [318,280] { let p=NSBezierPath();p.lineWidth=10;p.lineCapStyle = .round;p.move(to: NSPoint(x:x,y:y));p.line(to:NSPoint(x:x+94,y:y));p.stroke() } }
        NSColor(calibratedRed:0.17,green:0.28,blue:0.21,alpha:1).setStroke()
        let bridge=NSBezierPath();bridge.lineWidth=22;bridge.lineCapStyle = .round;bridge.move(to:NSPoint(x:174,y:217));bridge.line(to:NSPoint(x:338,y:217));bridge.move(to:NSPoint(x:308,y:243));bridge.line(to:NSPoint(x:338,y:217));bridge.line(to:NSPoint(x:308,y:191));bridge.stroke()
        image.unlockFocus()
        let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:pixels,pixelsHigh:pixels,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
        NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
        image.draw(in:NSRect(x:0,y:0,width:pixels,height:pixels));NSGraphicsContext.restoreGraphicsState()
        try bitmap.representation(using:.png,properties:[:])!.write(to:directory.appendingPathComponent("icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
    }
}
