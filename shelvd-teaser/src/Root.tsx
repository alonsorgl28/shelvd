import { Composition } from "remotion";
import { ShelvdTeaser } from "./ShelvdTeaser";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ShelvdTeaser"
      component={ShelvdTeaser}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
