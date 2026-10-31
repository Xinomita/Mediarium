"""Build on Windows using the installed Android SDK and Android Studio JBR.
No Gradle download required. Keep .signing/ to sign compatible future updates.
"""
import os, pathlib, subprocess, zipfile

root = pathlib.Path(__file__).resolve().parent
sdk = pathlib.Path(os.environ.get('ANDROID_HOME', str(pathlib.Path(os.environ['LOCALAPPDATA'])/'Android/Sdk')))
java = pathlib.Path(os.environ.get('JAVA_HOME', 'C:/Program Files/Android/Android Studio/jbr'))
bt = sdk/'build-tools/36.0.0'
android = sdk/'platforms/android-34/android.jar'
out = root/'build'
classes = out/'classes'
dex = out/'dex'
signing = root/'.signing'
for p in [out,classes,dex,signing]: p.mkdir(parents=True,exist_ok=True)
env = os.environ.copy(); env['JAVA_HOME']=str(java)
def run(*args): subprocess.run([str(a) for a in args],check=True,env=env,cwd=root)
run(bt/'aapt.exe','package','-f','-M',root/'AndroidManifest.xml','-S',root/'res','-A',root/'assets','-I',android,'-F',out/'resources.apk')
run(java/'bin/javac.exe','--release','8','-classpath',android,'-d',classes,*root.glob('src/**/*.java'))
run(java/'bin/java.exe','-cp',bt/'lib/d8.jar','com.android.tools.r8.D8','--lib',android,'--min-api','26','--output',dex,*classes.glob('**/*.class'))
raw=out/'unsigned.apk'
raw.write_bytes((out/'resources.apk').read_bytes())
with zipfile.ZipFile(raw,'a') as z:
    for p in dex.glob('*.dex'): z.write(p,p.name)
run(bt/'zipalign.exe','-f','4',raw,out/'aligned.apk')
key=signing/'mediarium-tv.jks'
if not key.exists():
    run(java/'bin/keytool.exe','-genkeypair','-keystore',key,'-storepass','android','-keypass','android','-alias','mediarium','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Mediarium Household TV')
run(java/'bin/java.exe','-jar',bt/'lib/apksigner.jar','sign','--ks',key,'--ks-key-alias','mediarium','--ks-pass','pass:android','--key-pass','pass:android','--out',out/'mediarium-tv.apk',out/'aligned.apk')
run(java/'bin/java.exe','-jar',bt/'lib/apksigner.jar','verify',out/'mediarium-tv.apk')
print('Built:',out/'mediarium-tv.apk')
