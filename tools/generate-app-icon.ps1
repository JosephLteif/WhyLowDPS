param(
  [string]$OutputDir = "desktop/src-tauri/icons"
)

Add-Type -AssemblyName System.Drawing

function New-IconCanvas {
  param(
    [int]$Size
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  return @($bitmap, $graphics)
}

function Draw-AppIcon {
  param(
    [System.Drawing.Graphics]$Graphics,
    [int]$Size
  )

  $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.ColorTranslator]::FromHtml("#0a0a0d"),
    [System.Drawing.ColorTranslator]::FromHtml("#16131a"),
    45
  )
  $Graphics.FillRectangle($bgBrush, $rect)

  $center = New-Object System.Drawing.PointF ($Size / 2.0), ($Size / 2.0)
  $outer = [int]($Size * 0.78)
  $inner = [int]($Size * 0.58)

  $ringRect = New-Object System.Drawing.RectangleF (($Size - $outer) / 2.0), (($Size - $outer) / 2.0), $outer, $outer
  $ringPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#d4a843")), ([Math]::Max(3, [int]($Size * 0.03)))
  $Graphics.DrawEllipse($ringPen, $ringRect)

  $halo = New-Object System.Drawing.Drawing2D.GraphicsPath
  $halo.AddEllipse(($Size * 0.18), ($Size * 0.18), ($Size * 0.64), ($Size * 0.64))
  $haloBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($halo)
  $haloBrush.CenterColor = [System.Drawing.Color]::FromArgb(100, 238, 195, 78)
  $haloBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
  $Graphics.FillPath($haloBrush, $halo)

  $gemPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $top = $Size * 0.20
  $mid = $Size * 0.34
  $bottom = $Size * 0.70
  $left = $Size * 0.35
  $right = $Size * 0.65
  $gemPath.AddPolygon(@(
    (New-Object System.Drawing.PointF ($Size * 0.50), $top),
    (New-Object System.Drawing.PointF $right, $mid),
    (New-Object System.Drawing.PointF ($Size * 0.58), $bottom),
    (New-Object System.Drawing.PointF ($Size * 0.42), $bottom),
    (New-Object System.Drawing.PointF $left, $mid)
  ))

  $gemBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF ($Size * 0.34), ($Size * 0.20), ($Size * 0.32), ($Size * 0.50)),
    [System.Drawing.ColorTranslator]::FromHtml("#f5d36a"),
    [System.Drawing.ColorTranslator]::FromHtml("#9a6f14"),
    90
  )
  $Graphics.FillPath($gemBrush, $gemPath)
  $gemOutline = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#fff0b2")), ([Math]::Max(2, [int]($Size * 0.012)))
  $Graphics.DrawPath($gemOutline, $gemPath)

  $shinePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(190, 255, 247, 206)), ([Math]::Max(2, [int]($Size * 0.01)))
  $Graphics.DrawLine($shinePen, ($Size * 0.46), ($Size * 0.27), ($Size * 0.54), ($Size * 0.42))
  $Graphics.DrawLine($shinePen, ($Size * 0.54), ($Size * 0.27), ($Size * 0.46), ($Size * 0.42))

  $swordPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#fff4c7")), ([Math]::Max(4, [int]($Size * 0.028)))
  $swordPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $swordPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $Graphics.DrawLine($swordPen, ($Size * 0.50), ($Size * 0.27), ($Size * 0.50), ($Size * 0.79))

  $crossPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#d4a843")), ([Math]::Max(4, [int]($Size * 0.022)))
  $crossPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $crossPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $Graphics.DrawLine($crossPen, ($Size * 0.35), ($Size * 0.52), ($Size * 0.65), ($Size * 0.52))

  $starBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#ffe79d"))
  $starPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $starSize = $Size * 0.07
  $starX = $Size * 0.50
  $starY = $Size * 0.18
  $starPath.AddPolygon(@(
    (New-Object System.Drawing.PointF $starX, ($starY - $starSize)),
    (New-Object System.Drawing.PointF ($starX + ($starSize * 0.28)), ($starY - ($starSize * 0.28))),
    (New-Object System.Drawing.PointF ($starX + $starSize), $starY),
    (New-Object System.Drawing.PointF ($starX + ($starSize * 0.28)), ($starY + ($starSize * 0.28))),
    (New-Object System.Drawing.PointF $starX, ($starY + $starSize)),
    (New-Object System.Drawing.PointF ($starX - ($starSize * 0.28)), ($starY + ($starSize * 0.28))),
    (New-Object System.Drawing.PointF ($starX - $starSize), $starY),
    (New-Object System.Drawing.PointF ($starX - ($starSize * 0.28)), ($starY - ($starSize * 0.28)))
  ))
  $Graphics.FillPath($starBrush, $starPath)

  $Graphics.Dispose()
  $bgBrush.Dispose()
  $ringPen.Dispose()
  $halo.Dispose()
  $haloBrush.Dispose()
  $gemPath.Dispose()
  $gemBrush.Dispose()
  $gemOutline.Dispose()
  $shinePen.Dispose()
  $swordPen.Dispose()
  $crossPen.Dispose()
  $starPath.Dispose()
  $starBrush.Dispose()
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$sizes = 32, 64, 128, 256, 512, 1024
$tempPngs = @()

foreach ($size in $sizes) {
  $pair = New-IconCanvas -Size $size
  $bitmap = $pair[0]
  $graphics = $pair[1]
  Draw-AppIcon -Graphics $graphics -Size $size
  $path = Join-Path $OutputDir ("{0}x{0}.png" -f $size)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $tempPngs += $path
  $bitmap.Dispose()
}

Copy-Item (Join-Path $OutputDir "128x128.png") (Join-Path $OutputDir "icon.png") -Force
Copy-Item (Join-Path $OutputDir "256x256.png") (Join-Path $OutputDir "128x128@2x.png") -Force
