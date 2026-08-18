import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Camera, KeyRound, LogOut, Moon, Sun } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useDark } from "../hooks/useDark";
import type { Profile } from "../lib/types";
import { INSTRUMENTS, ROLE_CHIP, ROLE_LABEL } from "../lib/constants";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Toggle,
} from "../components/ui";
import { Avatar } from "../components/Avatar";

export default function ProfileScreen() {
  const { profile, refreshProfile } = useOutletContext<{
    profile: Profile;
    refreshProfile: () => Promise<void>;
  }>();
  const [dark, setDark] = useDark();

  const [displayName, setDisplayName] = useState(profile.display_name);
  const [fullName, setFullName] = useState(profile.full_name);
  const [instrument, setInstrument] = useState(profile.instrument);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(profile.display_name);
    setFullName(profile.full_name);
    setInstrument(profile.instrument);
  }, [profile]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setSaveMsg(null);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        full_name: fullName.trim(),
        instrument,
      })
      .eq("id", profile.id);
    setSavingProfile(false);
    if (error) {
      setSaveMsg(error.message);
      return;
    }
    setSaveMsg("Saved ✓");
    await refreshProfile();
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pw1.length < 6) {
      setPwMsg({ tone: "error", text: "New password must be at least 6 characters." });
      return;
    }
    if (pw1 !== pw2) {
      setPwMsg({ tone: "error", text: "Passwords don't match." });
      return;
    }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setSavingPw(false);
    if (error) {
      setPwMsg({ tone: "error", text: error.message });
      return;
    }
    setPw1("");
    setPw2("");
    setPwMsg({ tone: "success", text: "Password updated. It's stored as a hashed Auth credential — never plaintext." });
  }

  /** Downscale + re-encode so phone photos (HEIC, huge JPEGs) always fit the bucket. */
  function resizeImage(
    file: File,
    maxSize: number,
    quality: number,
    mime: string
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Couldn't process that image."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(new Error("Couldn't process that image.")),
          mime,
          quality
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Couldn't read that image — try a JPEG or PNG."));
      };
      img.src = url;
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setSaveMsg("Please choose an image file.");
      return;
    }
    setUploading(true);
    setSaveMsg(null);
    try {
      // Keep supported, small photos as-is (preserves quality + transparency);
      // downscale/convert everything else (HEIC, >4.5MB) so it uploads anywhere.
      const SUPPORTED = ["image/png", "image/jpeg", "image/webp"];
      const needsProcessing =
        !SUPPORTED.includes(file.type) || file.size > 4.5 * 1024 * 1024;
      let blob: Blob = file;
      let contentType = file.type;
      if (needsProcessing) {
        contentType = file.type === "image/png" ? "image/png" : "image/jpeg";
        blob = await resizeImage(file, 1024, 0.85, contentType);
      }
      const ext = contentType === "image/png" ? "png" : "jpg";
      const path = `${profile.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: data.publicUrl })
        .eq("id", profile.id);
      if (error) throw error;
      await refreshProfile();
    } catch (err) {
      setSaveMsg(
        err instanceof Error ? err.message : "Couldn't upload the photo."
      );
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto() {
    if (!profile.avatar_url) return;
    if (!window.confirm("Remove your profile picture?")) return;
    setUploading(true);
    setSaveMsg(null);
    try {
      // Delete this user's stored avatar files from storage (best-effort).
      const { data: files } = await supabase.storage
        .from("avatars")
        .list(profile.id);
      if (files?.length) {
        await supabase.storage
          .from("avatars")
          .remove(files.map((f) => `${profile.id}/${f.name}`));
      }
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: "" })
        .eq("id", profile.id);
      if (error) throw error;
      await refreshProfile();
    } catch (err) {
      setSaveMsg(
        err instanceof Error ? err.message : "Couldn't remove the photo."
      );
    } finally {
      setUploading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <div className="px-4 pb-6 pt-5">
      <h1 className="mb-4 text-xl font-black text-ink dark:text-zinc-100">Profile</h1>

      {/* header card */}
      <Card className="flex items-center gap-4 p-5">
        <div className="flex flex-col items-center gap-1.5">
          <div className="relative">
            <Avatar name={profile.display_name || profile.full_name} url={profile.avatar_url} size="lg" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full bg-forest text-white ring-2 ring-white transition-colors hover:bg-mid disabled:opacity-60 dark:ring-zinc-900"
              aria-label="Upload photo"
            >
              <Camera className="size-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e)} />
          </div>
          {profile.avatar_url && (
            <button
              type="button"
              onClick={() => void removePhoto()}
              disabled={uploading}
              className="text-[11px] font-semibold text-zinc-400 transition-colors hover:text-red-500 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-red-400"
            >
              Remove photo
            </button>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-ink dark:text-zinc-100">
            {profile.display_name || profile.full_name}
          </p>
          <p className="truncate text-xs text-zinc-400">{profile.full_name}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge className={ROLE_CHIP[profile.role]}>
              {ROLE_LABEL[profile.role]}
            </Badge>
            {profile.instrument && (
              <Badge className="bg-moss text-forest dark:bg-forest/40 dark:text-moss">
                {profile.instrument}
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {/* edit info */}
      <form onSubmit={saveProfile} className="mt-4 space-y-4">
        <Card className="space-y-4 p-5">
          <Field label="Display name">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="What everyone calls you"
            />
          </Field>
          <Field label="Full name">
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>
          <Field label="Instrument / section">
            <Select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
              <option value="">—</option>
              {INSTRUMENTS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
          </Field>
          {saveMsg && (
            <Alert tone={saveMsg === "Saved ✓" ? "success" : "error"}>{saveMsg}</Alert>
          )}
          <Button type="submit" loading={savingProfile}>
            Save changes
          </Button>
        </Card>
      </form>

      {/* password */}
      <form onSubmit={changePassword} className="mt-4 space-y-4">
        <Card className="space-y-4 p-5">
          <p className="flex items-center gap-2 text-sm font-bold text-ink dark:text-zinc-100">
            <KeyRound className="size-4 text-gold" /> Change password
          </p>
          <Field label="New password">
            <Input
              type="password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Repeat new password">
            <Input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {pwMsg && <Alert tone={pwMsg.tone}>{pwMsg.text}</Alert>}
          <Button type="submit" variant="outline" loading={savingPw}>
            Update password
          </Button>
        </Card>
      </form>

      {/* appearance */}
      <Card className="mt-4 flex items-center justify-between p-5">
        <div className="flex items-center gap-3">
          {dark ? <Moon className="size-5 text-gold" /> : <Sun className="size-5 text-gold" />}
          <div>
            <p className="text-sm font-bold text-ink dark:text-zinc-100">Dark mode</p>
            <p className="text-xs text-zinc-400">Easier on the eyes at night games</p>
          </div>
        </div>
        <Toggle checked={dark} onChange={setDark} label="Dark mode" />
      </Card>

      {/* sign out */}
      <Button variant="danger" className="mt-4 w-full" onClick={() => void signOut()}>
        <LogOut className="size-4" /> Sign out
      </Button>

      <p className="mt-6 text-center text-[11px] text-zinc-400">
        RHS Band Attendance Manager · demo build
      </p>
    </div>
  );
}