param([ValidateSet('read','write','delete')][string]$Action)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class HqCredential {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct Credential { public int Flags, Type; public string TargetName, Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist, AttributeCount; public IntPtr Attributes; public string TargetAlias, UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CredWriteW")] static extern bool Write(ref Credential c, int flags);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CredReadW")] static extern bool Read(string target, int type, int flags, out IntPtr result);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CredDeleteW")] static extern bool Delete(string target, int type, int flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
  const string Target = "HeartQuarters/YouTube";
  public static void Save(string value) { byte[] bytes = Encoding.Unicode.GetBytes(value); IntPtr blob = Marshal.AllocCoTaskMem(bytes.Length); try { Marshal.Copy(bytes, 0, blob, bytes.Length); var c = new Credential { Type=1, TargetName=Target, CredentialBlobSize=bytes.Length, CredentialBlob=blob, Persist=2, UserName="HeartQuarters" }; if (!Write(ref c, 0)) throw new System.ComponentModel.Win32Exception(); } finally { Marshal.FreeCoTaskMem(blob); } }
  public static string Load() { IntPtr p; if (!Read(Target, 1, 0, out p)) { if (Marshal.GetLastWin32Error()==1168) return ""; throw new System.ComponentModel.Win32Exception(); } try { var c = (Credential)Marshal.PtrToStructure(p, typeof(Credential)); return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2); } finally { CredFree(p); } }
  public static void Remove() { if (!Delete(Target, 1, 0) && Marshal.GetLastWin32Error()!=1168) throw new System.ComponentModel.Win32Exception(); }
}
'@
if ($Action -eq 'read') { [Console]::Out.Write([HqCredential]::Load()) }
elseif ($Action -eq 'write') { [HqCredential]::Save([Console]::In.ReadToEnd()) }
else { [HqCredential]::Remove() }
