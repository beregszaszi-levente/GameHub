param(
  [string]$Output = "$PSScriptRoot\..\assets\icon.png",
  [int]$Size = 512
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outputPath = [System.IO.Path]::GetFullPath($Output)
$dir = [System.IO.Path]::GetDirectoryName($outputPath)
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$bmp = New-Object System.Drawing.Bitmap($Size, $Size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

# Lekerekített négyzet
$pad = [int]($Size * 0.055)
$radius = [int]($Size * 0.23)
$rect = New-Object System.Drawing.Rectangle($pad, $pad, ($Size - 2 * $pad), ($Size - 2 * $pad))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()

$c1 = [System.Drawing.ColorTranslator]::FromHtml('#5C9BFF')
$c2 = [System.Drawing.ColorTranslator]::FromHtml('#22C7B8')
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 135)
$g.FillPath($grad, $path)

# Enyhe belső fény a tetején (lágy átmenettel, éles sáv nélkül)
$shineRect = New-Object System.Drawing.Rectangle($rect.X, $rect.Y, $rect.Width, $rect.Height)
$shine = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $shineRect,
  [System.Drawing.Color]::FromArgb(55, 255, 255, 255),
  [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
  90
)
$blend = New-Object System.Drawing.Drawing2D.ColorBlend
$blend.Colors = @(
  [System.Drawing.Color]::FromArgb(55, 255, 255, 255),
  [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
  [System.Drawing.Color]::FromArgb(0, 255, 255, 255)
)
$blend.Positions = @(0.0, 0.55, 1.0)
$shine.InterpolationColors = $blend
$g.SetClip($path)
$g.FillRectangle($shine, $shineRect)
$g.ResetClip()

# Lejátszás háromszög
$cx = $Size * 0.525
$cy = $Size * 0.5
$w = $Size * 0.19
$h = $Size * 0.235
$points = @(
  (New-Object System.Drawing.PointF(($cx - $w * 0.55), ($cy - $h))),
  (New-Object System.Drawing.PointF(($cx - $w * 0.55), ($cy + $h))),
  (New-Object System.Drawing.PointF(($cx + $w * 0.95), $cy))
)
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillPolygon($white, [System.Drawing.PointF[]]$points)

$g.Dispose()
$bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

"Kész: $outputPath ($Size x $Size)"
