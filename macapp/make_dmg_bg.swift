import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

// DMG 安装窗口背景：660×400，亮色底 + 深色文字。
// 说明文字放在 y≈300，避开 Finder 底部状态栏（窗口内容实际可见约 354pt）。

let W: CGFloat = 660
let H: CGFloat = 400
let scale: CGFloat = CommandLine.arguments.count > 2
    ? CGFloat(Double(CommandLine.arguments[2]) ?? 1) : 1

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha)
}

let cs = CGColorSpace(name: CGColorSpace.sRGB)!
guard let ctx = CGContext(data: nil, width: Int(W * scale), height: Int(H * scale),
                          bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { fatalError("context") }

ctx.scaleBy(x: scale, y: scale)
ctx.translateBy(x: 0, y: H)
ctx.scaleBy(x: 1, y: -1)

// 亮色背景
ctx.setFillColor(color(0xFBFCFD))
ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
let bg = CGGradient(colorsSpace: cs,
                    colors: [color(0xFFFFFF), color(0xEDF4F5)] as CFArray,
                    locations: [0, 1])!
ctx.drawLinearGradient(bg, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: H), options: [])

// 中央很淡的青色光晕
let glow = CGGradient(colorsSpace: cs,
                      colors: [color(0x9FDDD3, 0.30), color(0x9FDDD3, 0)] as CFArray,
                      locations: [0, 1])!
ctx.drawRadialGradient(glow, startCenter: CGPoint(x: W / 2, y: 195), startRadius: 0,
                       endCenter: CGPoint(x: W / 2, y: 195), endRadius: 300, options: [])

// 两个放置区域的浅色卡片
func card(_ rect: CGRect) {
    let path = CGPath(roundedRect: rect, cornerWidth: 24, cornerHeight: 24, transform: nil)
    ctx.addPath(path)
    ctx.setFillColor(color(0xE8F4F1, 0.9))
    ctx.fillPath()
    ctx.addPath(path)
    ctx.setStrokeColor(color(0xD2E7E2))
    ctx.setLineWidth(1)
    ctx.strokePath()
}
card(CGRect(x: 90, y: 110, width: 160, height: 160))
card(CGRect(x: 410, y: 110, width: 160, height: 160))

// 文字
func text(_ s: String, fontName: String, size: CGFloat, color: CGColor,
          centerX: CGFloat, baselineY: CGFloat)
{
    let font = CTFontCreateWithName(fontName as CFString, size, nil)
    let attrs: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
    let width = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    ctx.saveGState()
    ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    ctx.textPosition = CGPoint(x: centerX - width / 2, y: baselineY)
    CTLineDraw(line, ctx)
    ctx.restoreGState()
}

text("Super DeepSeek", fontName: "PingFangSC-Semibold", size: 26,
     color: color(0x0F2433), centerX: W / 2, baselineY: 54)
text("Powered By DeepSeek Platform", fontName: "PingFangSC-Regular", size: 10,
     color: color(0x7C8B96), centerX: W / 2, baselineY: 74)
text("把左边的 App 拖到右边的 Applications 文件夹", fontName: "PingFangSC-Regular", size: 13.5,
     color: color(0x4F6572), centerX: W / 2, baselineY: 98)

// 箭头
let arrowY: CGFloat = 190
ctx.setStrokeColor(color(0x11A492))
ctx.setLineWidth(4)
ctx.setLineCap(.round)
let arrow = CGMutablePath()
arrow.move(to: CGPoint(x: 278, y: arrowY))
arrow.addLine(to: CGPoint(x: 366, y: arrowY))
ctx.addPath(arrow)
ctx.strokePath()
let head = CGMutablePath()
head.move(to: CGPoint(x: 368, y: arrowY))
head.addLine(to: CGPoint(x: 349, y: arrowY - 10))
head.addLine(to: CGPoint(x: 349, y: arrowY + 10))
head.closeSubpath()
ctx.addPath(head)
ctx.setFillColor(color(0x11A492))
ctx.fillPath()

// 底部说明（避开状态栏）
text("首次打开：在 App 上右键 → 打开（应用未公证，系统提示属正常）",
     fontName: "PingFangSC-Regular", size: 11.5,
     color: color(0x5A6B77), centerX: W / 2, baselineY: 298)
text("对话数据默认仅保存在本机",
     fontName: "PingFangSC-Regular", size: 10.5,
     color: color(0x8B98A2), centerX: W / 2, baselineY: 320)

guard let image = ctx.makeImage() else { fatalError("image") }
let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "dmg-background.png")
guard let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fatalError("dest") }
CGImageDestinationAddImage(dest, image, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("write") }
print("wrote \(out.path)")
