import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import { isSupabaseConfigured } from "./lib/supabase";
import AttendanceScreen from "./screens/AttendanceScreen";
import CalendarScreen from "./screens/CalendarScreen";
import ChatScreen from "./screens/ChatScreen";
import CheckInScreen from "./screens/CheckInScreen";
import NeedsSetup from "./screens/NeedsSetup";
import ProfileScreen from "./screens/ProfileScreen";
import RosterScreen from "./screens/RosterScreen";
import UpdatePasswordScreen from "./screens/UpdatePasswordScreen";
import WelcomeScreen from "./screens/WelcomeScreen";

export default function App() {
  if (!isSupabaseConfigured) {
    return <NeedsSetup />;
  }
  return (
    <Routes>
      <Route path="/welcome" element={<WelcomeScreen />} />
      <Route path="/update-password" element={<UpdatePasswordScreen />} />
      <Route element={<AppShell />}>
        <Route index element={<CalendarScreen />} />
        <Route path="checkin" element={<CheckInScreen />} />
        <Route path="attendance" element={<AttendanceScreen />} />
        <Route path="chat" element={<ChatScreen />} />
        <Route path="roster" element={<RosterScreen />} />
        <Route path="profile" element={<ProfileScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}