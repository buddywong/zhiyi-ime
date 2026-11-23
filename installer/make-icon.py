from PIL import Image, ImageDraw, ImageFont
import os
S=256
im=Image.new('RGBA',(S,S),(0,0,0,0))
d=ImageDraw.Draw(im)
# warm red rounded square
d.rounded_rectangle([8,8,S-8,S-8], radius=58, fill=(182,78,53,255))
# subtle inner border
d.rounded_rectangle([17,17,S-17,S-17], radius=50, outline=(255,248,238,70), width=3)
font=None
for fp in [r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf', r'C:\Windows\Fonts\simsun.ttc']:
    if os.path.exists(fp):
        try:
            font=ImageFont.truetype(fp, 150)
            break
        except Exception:
            pass
if font is None:
    font=ImageFont.load_default()
text='知'
bbox=d.textbbox((0,0), text, font=font)
w=bbox[2]-bbox[0]; h=bbox[3]-bbox[1]
d.text(((S-w)/2-bbox[0], (S-h)/2-bbox[1]-4), text, font=font, fill=(255,248,238,255))
im.save(r'F:\deepseek\zhiyi-ime\assets\zhiyi.png')
im.save(r'F:\deepseek\zhiyi-ime\assets\zhiyi.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('icon ok', os.path.getsize(r'F:\deepseek\zhiyi-ime\assets\zhiyi.ico'))
