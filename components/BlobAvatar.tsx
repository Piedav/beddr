import { Canvas, ColorMatrix, Image as SkiaImage, useImage } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { createHueRotationMatrix } from './BlobCompanion';

const PROFILE_PICTURE_SOURCE = require('../assets/companions/blob/profile-picture.png');

type BlobAvatarProps = {
  hue?: number;
  size: number;
  style?: StyleProp<ViewStyle>;
};

// Renders just the hue-shifted blob image filling whatever circular frame
// the caller already draws (background/border/overflow:hidden) — so each
// screen keeps its own avatar chrome and only swaps out what goes inside it.
export function BlobAvatar({ hue = 0, size, style }: BlobAvatarProps) {
  const image = useImage(PROFILE_PICTURE_SOURCE);
  const hueMatrix = useMemo(() => createHueRotationMatrix(hue), [hue]);

  // The `size` prop is the caller's full box, but a bordered wrap (every
  // caller has one) shrinks the actual content area RN renders into below
  // that — drawing the Skia image at the un-shrunk `size` then overflowed
  // and got clipped off-center. Measuring the real rendered box side-steps
  // that mismatch regardless of border width.
  const [measuredSize, setMeasuredSize] = useState(size);
  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const measured = Math.min(width, height);
    if (measured > 0 && measured !== measuredSize) {
      setMeasuredSize(measured);
    }
  };

  return (
    <View style={[styles.canvasWrap, style]} onLayout={handleLayout}>
      <Canvas style={styles.canvas}>
        {image && (
          <SkiaImage
            fit="cover"
            height={measuredSize}
            image={image}
            width={measuredSize}
            x={0}
            y={0}
          >
            <ColorMatrix matrix={hueMatrix} />
          </SkiaImage>
        )}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  canvasWrap: {
    width: '100%',
    height: '100%',
  },
  canvas: {
    width: '100%',
    height: '100%',
  },
});
