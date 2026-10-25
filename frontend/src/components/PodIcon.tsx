import { Image } from "@kobalte/core/image";

import { LogoIcon } from "./Logo";

export interface PodIconProps {
  // URL of the pod's cover image. Undefined falls back to the app's logo.
  src?: string;
}

// The pod's icon, cropped to a circle like the user's avatar (see
// layout/UserMenu.tsx). While the cover is missing, loading or failed,
// Kobalte shows the fallback: the app's logo.
export default function PodIcon(props: PodIconProps) {
  return (
    <Image fallbackDelay={0} class="avatar">
      <Image.Img src={props.src} alt="" class="avatar-img" />
      <Image.Fallback>
        <LogoIcon size={26} />
      </Image.Fallback>
    </Image>
  );
}
