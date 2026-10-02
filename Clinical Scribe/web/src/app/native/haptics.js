// Short vibrations for touch feedback in the Android app.
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export function haptic(kind = "light") {
  const done = () => {};
  if (kind === "success") return Haptics.notification({ type: NotificationType.Success }).catch(done);
  if (kind === "error") return Haptics.notification({ type: NotificationType.Error }).catch(done);
  if (kind === "medium") return Haptics.impact({ style: ImpactStyle.Medium }).catch(done);
  return Haptics.impact({ style: ImpactStyle.Light }).catch(done);
}
