import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// 原创亮色鲸鱼图标：天空蓝渐变底 + 奶白鲸鱼与喷水，简洁、友好。
// 1024×1024 设计坐标，按目标尺寸矢量渲染。

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(
        red: CGFloat((hex >> 16) & 0xFF) / 255,
        green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255,
        alpha: alpha
    )
}

func gradient(_ colors: [CGColor], _ locations: [CGFloat]) -> CGGradient {
    CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors as CFArray,
               locations: locations)!
}

func drawIcon(in ctx: CGContext, size: CGFloat) {
    let scale = size / 1024
    ctx.saveGState()
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: 0, y: 1024)
    ctx.scaleBy(x: 1, y: -1)

    let bgRect = CGRect(x: 100, y: 100, width: 824, height: 824)
    let bgPath = CGPath(roundedRect: bgRect, cornerWidth: 186, cornerHeight: 186, transform: nil)

    ctx.saveGState()
    ctx.addPath(bgPath)
    ctx.clip()
    // 明亮天空渐变
    ctx.drawLinearGradient(
        gradient([color(0x9BE7FF), color(0x4D8DF7), color(0x3B6FF0)], [0, 0.58, 1]),
        start: CGPoint(x: 512, y: 100), end: CGPoint(x: 512, y: 924), options: []
    )
    // 柔和光斑
    ctx.drawRadialGradient(
        gradient([color(0xFFFFFF, 0.32), color(0xFFFFFF, 0)], [0, 1]),
        startCenter: CGPoint(x: 470, y: 340), startRadius: 10,
        endCenter: CGPoint(x: 470, y: 340), endRadius: 520, options: []
    )
    // 背景泡泡
    func bubble(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ a: CGFloat) {
        ctx.setFillColor(color(0xFFFFFF, a))
        ctx.fillEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
    }
    bubble(790, 250, 18, 0.35)
    bubble(828, 300, 9, 0.28)
    bubble(230, 760, 14, 0.22)
    bubble(270, 800, 7, 0.18)
    ctx.restoreGState()

    // 底部海水
    let sea = CGMutablePath()
    sea.move(to: CGPoint(x: 100, y: 790))
    sea.addCurve(to: CGPoint(x: 540, y: 776),
                 control1: CGPoint(x: 250, y: 752), control2: CGPoint(x: 390, y: 806))
    sea.addCurve(to: CGPoint(x: 924, y: 792),
                 control1: CGPoint(x: 700, y: 744), control2: CGPoint(x: 840, y: 812))
    sea.addLine(to: CGPoint(x: 924, y: 924))
    sea.addLine(to: CGPoint(x: 100, y: 924))
    sea.closeSubpath()
    ctx.saveGState()
    ctx.addPath(bgPath)
    ctx.clip()
    ctx.addPath(sea)
    ctx.setFillColor(color(0x2F63D8, 0.22))
    ctx.fillPath()
    ctx.restoreGState()

    // 鲸鱼尾巴：两片圆润尾鳍
    ctx.setFillColor(color(0xFFF8E8))
    ctx.saveGState()
    ctx.translateBy(x: 282, y: 404)
    ctx.rotate(by: 0.62)
    ctx.fillEllipse(in: CGRect(x: -104, y: -44, width: 208, height: 88))
    ctx.restoreGState()
    ctx.saveGState()
    ctx.translateBy(x: 272, y: 636)
    ctx.rotate(by: -0.58)
    ctx.fillEllipse(in: CGRect(x: -104, y: -44, width: 208, height: 88))
    ctx.restoreGState()

    // 身体
    let body = CGMutablePath()
    body.move(to: CGPoint(x: 320, y: 618))
    body.addCurve(to: CGPoint(x: 336, y: 478),
                  control1: CGPoint(x: 290, y: 560), control2: CGPoint(x: 292, y: 506))
    body.addCurve(to: CGPoint(x: 532, y: 414),
                  control1: CGPoint(x: 366, y: 440), control2: CGPoint(x: 436, y: 412))
    body.addCurve(to: CGPoint(x: 726, y: 468),
                  control1: CGPoint(x: 628, y: 418), control2: CGPoint(x: 704, y: 430))
    body.addCurve(to: CGPoint(x: 784, y: 552),
                  control1: CGPoint(x: 772, y: 496), control2: CGPoint(x: 790, y: 522))
    body.addCurve(to: CGPoint(x: 736, y: 650),
                  control1: CGPoint(x: 780, y: 608), control2: CGPoint(x: 764, y: 636))
    body.addCurve(to: CGPoint(x: 520, y: 690),
                  control1: CGPoint(x: 682, y: 692), control2: CGPoint(x: 592, y: 702))
    body.addCurve(to: CGPoint(x: 320, y: 618),
                  control1: CGPoint(x: 444, y: 676), control2: CGPoint(x: 348, y: 668))
    body.closeSubpath()
    ctx.addPath(body)
    ctx.setFillColor(color(0xFFFDF6))
    ctx.fillPath()

    // 腹部淡蓝
    ctx.saveGState()
    ctx.addPath(body)
    ctx.clip()
    let belly = CGMutablePath()
    belly.move(to: CGPoint(x: 300, y: 600))
    belly.addCurve(to: CGPoint(x: 760, y: 600),
                   control1: CGPoint(x: 460, y: 730), control2: CGPoint(x: 640, y: 710))
    belly.addLine(to: CGPoint(x: 760, y: 760))
    belly.addLine(to: CGPoint(x: 300, y: 760))
    belly.closeSubpath()
    ctx.addPath(belly)
    ctx.setFillColor(color(0xBFEFFF, 0.6))
    ctx.fillPath()
    ctx.restoreGState()

    // 眼睛
    ctx.setFillColor(color(0x1B3A6B))
    ctx.fillEllipse(in: CGRect(x: 686, y: 496, width: 30, height: 30))
    ctx.setFillColor(color(0xFFFFFF))
    ctx.fillEllipse(in: CGRect(x: 696, y: 502, width: 10, height: 10))

    // 微笑
    ctx.setStrokeColor(color(0x1B3A6B, 0.55))
    ctx.setLineWidth(7)
    ctx.setLineCap(.round)
    let smile = CGMutablePath()
    smile.move(to: CGPoint(x: 700, y: 560))
    smile.addCurve(to: CGPoint(x: 752, y: 552),
                   control1: CGPoint(x: 718, y: 570), control2: CGPoint(x: 738, y: 564))
    ctx.addPath(smile)
    ctx.strokePath()

    // 胸鳍
    ctx.setFillColor(color(0xA9E4FF))
    ctx.saveGState()
    ctx.translateBy(x: 560, y: 610)
    ctx.rotate(by: 0.32)
    ctx.fillEllipse(in: CGRect(x: -52, y: -18, width: 104, height: 36))
    ctx.restoreGState()

    // 喷水
    ctx.setFillColor(color(0xFFFFFF, 0.95))
    ctx.fillEllipse(in: CGRect(x: 540, y: 318, width: 26, height: 26))
    ctx.fillEllipse(in: CGRect(x: 572, y: 282, width: 38, height: 38))
    ctx.fillEllipse(in: CGRect(x: 614, y: 250, width: 22, height: 22))
    ctx.setFillColor(color(0xFFFFFF, 0.65))
    ctx.fillEllipse(in: CGRect(x: 560, y: 246, width: 14, height: 14))
    ctx.fillEllipse(in: CGRect(x: 622, y: 300, width: 12, height: 12))

    ctx.restoreGState()
}

func render(size: Int) -> CGImage? {
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                              bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    ctx.setAllowsAntialiasing(true)
    ctx.interpolationQuality = .high
    drawIcon(in: ctx, size: CGFloat(size))
    return ctx.makeImage()
}

func writePNG(_ image: CGImage, to url: URL) throws {
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { throw NSError(domain: "icon", code: 1) }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { throw NSError(domain: "icon", code: 2) }
}

let outDir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let variants: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

for (name, px) in variants {
    guard let image = render(size: px) else { fatalError("render failed \(px)") }
    try writePNG(image, to: outDir.appendingPathComponent("\(name).png"))
}
print("icons written to \(outDir.path)")
