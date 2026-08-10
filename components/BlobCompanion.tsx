import { Ionicons } from '@expo/vector-icons';
import {
  Canvas,
  ColorMatrix,
  Image as SkiaImage,
  useImage,
} from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleProp, StyleSheet, ViewStyle } from 'react-native';

const SLEEPING_FRAME_SOURCES = [
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-01.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-02.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-03.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-04.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-05.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-06.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-07.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-08.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-09.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-10.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-11.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-12.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-13.png'),
  require('../assets/companions/blob/sleeping/blob-bounce-eyes-closed-14.png'),
];

const SLEEPING_FRAME_DURATION_MS = 1000 / 6;

const SPARKLE_COLOR = '#FFE9A8';

type SparkleSlot = {
  angleDeg: number;
  radiusRatio: number;
  sizeRatio: number;
  delayMs: number;
};

// Fixed, hand-placed positions around the blob's bounding circle (angle +
// distance from center, both as ratios of size so they scale with it).
// Revealed one at a time as sparkleLevel rises, rather than randomly
// generated, so the layout is stable across re-renders.
const SPARKLE_SLOTS: SparkleSlot[] = [
  { angleDeg: 15, radiusRatio: 0.48, sizeRatio: 0.11, delayMs: 0 },
  { angleDeg: 65, radiusRatio: 0.4, sizeRatio: 0.08, delayMs: 260 },
  { angleDeg: 120, radiusRatio: 0.46, sizeRatio: 0.13, delayMs: 520 },
  { angleDeg: 175, radiusRatio: 0.38, sizeRatio: 0.09, delayMs: 780 },
  { angleDeg: 230, radiusRatio: 0.44, sizeRatio: 0.1, delayMs: 130 },
  { angleDeg: 285, radiusRatio: 0.5, sizeRatio: 0.07, delayMs: 390 },
  { angleDeg: 335, radiusRatio: 0.36, sizeRatio: 0.12, delayMs: 650 },
  { angleDeg: 95, radiusRatio: 0.3, sizeRatio: 0.08, delayMs: 910 },
];

type BlobCompanionProps = {
  hue?: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** 0 (no sparkles) to 1 (fully sparkly) — how close to today's focus goal. */
  sparkleLevel?: number;
};

function createHueRotationMatrix(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return [
    0.213 + cosine * 0.787 - sine * 0.213,
    0.715 - cosine * 0.715 - sine * 0.715,
    0.072 - cosine * 0.072 + sine * 0.928,
    0,
    0,
    0.213 - cosine * 0.213 + sine * 0.143,
    0.715 + cosine * 0.285 + sine * 0.14,
    0.072 - cosine * 0.072 - sine * 0.283,
    0,
    0,
    0.213 - cosine * 0.213 - sine * 0.787,
    0.715 - cosine * 0.715 + sine * 0.715,
    0.072 + cosine * 0.928 + sine * 0.072,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

function Sparkle({
  slot,
  size,
  active,
}: {
  slot: SparkleSlot;
  size: number;
  active: boolean;
}) {
  const twinkle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      twinkle.stopAnimation();
      twinkle.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(slot.delayMs),
        Animated.timing(twinkle, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(twinkle, {
          toValue: 0.35,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [active, slot.delayMs, twinkle]);

  if (!active) return null;

  const radius = slot.radiusRatio * (size / 2);
  const angleRad = (slot.angleDeg * Math.PI) / 180;
  const sparkleSize = Math.max(8, size * slot.sizeRatio);
  const left = size / 2 + radius * Math.cos(angleRad) - sparkleSize / 2;
  const top = size / 2 + radius * Math.sin(angleRad) - sparkleSize / 2;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.sparkle,
        {
          left,
          top,
          opacity: twinkle.interpolate({
            inputRange: [0, 1],
            outputRange: [0.35, 1],
          }),
          transform: [
            {
              scale: twinkle.interpolate({
                inputRange: [0, 1],
                outputRange: [0.75, 1.1],
              }),
            },
          ],
        },
      ]}
    >
      <Ionicons name="sparkles" size={sparkleSize} color={SPARKLE_COLOR} />
    </Animated.View>
  );
}

function CompanionSparkles({ level, size }: { level: number; size: number }) {
  const clampedLevel = Math.max(0, Math.min(1, level));
  const activeCount = Math.round(clampedLevel * SPARKLE_SLOTS.length);

  if (activeCount === 0) return null;

  return (
    <>
      {SPARKLE_SLOTS.map((slot, index) => (
        <Sparkle key={index} slot={slot} size={size} active={index < activeCount} />
      ))}
    </>
  );
}

export function BlobCompanion({
  hue = 0,
  size = 340,
  style,
  sparkleLevel = 0,
}: BlobCompanionProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const frames = [
    useImage(SLEEPING_FRAME_SOURCES[0]),
    useImage(SLEEPING_FRAME_SOURCES[1]),
    useImage(SLEEPING_FRAME_SOURCES[2]),
    useImage(SLEEPING_FRAME_SOURCES[3]),
    useImage(SLEEPING_FRAME_SOURCES[4]),
    useImage(SLEEPING_FRAME_SOURCES[5]),
    useImage(SLEEPING_FRAME_SOURCES[6]),
    useImage(SLEEPING_FRAME_SOURCES[7]),
    useImage(SLEEPING_FRAME_SOURCES[8]),
    useImage(SLEEPING_FRAME_SOURCES[9]),
    useImage(SLEEPING_FRAME_SOURCES[10]),
    useImage(SLEEPING_FRAME_SOURCES[11]),
    useImage(SLEEPING_FRAME_SOURCES[12]),
    useImage(SLEEPING_FRAME_SOURCES[13]),
  ];
  const hueMatrix = useMemo(() => createHueRotationMatrix(hue), [hue]);

  const loadAnimation = useRef(new Animated.Value(0)).current;
  const hasLoadedOnceRef = useRef(false);
  const loadedFrameCount = frames.filter(Boolean).length;

  useEffect(() => {
    if (hasLoadedOnceRef.current) return;
    if (loadedFrameCount === 0) return;

    hasLoadedOnceRef.current = true;
    Animated.timing(loadAnimation, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [loadAnimation, loadedFrameCount]);

  useEffect(() => {
    const frameTimer = setInterval(() => {
      setFrameIndex((currentFrame) =>
        (currentFrame + 1) % SLEEPING_FRAME_SOURCES.length
      );
    }, SLEEPING_FRAME_DURATION_MS);

    return () => clearInterval(frameTimer);
  }, []);

  return (
    <Animated.View
      accessibilityLabel="Sleeping blob companion"
      accessibilityRole="image"
      style={[
        styles.container,
        { height: size, maxWidth: size },
        style,
        {
          opacity: loadAnimation,
          transform: [
            {
              translateY: loadAnimation.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Canvas style={styles.image}>
        {frames[frameIndex] && (
          <SkiaImage
            fit="contain"
            height={size}
            image={frames[frameIndex]}
            width={size}
            x={0}
            y={0}
          >
            <ColorMatrix matrix={hueMatrix} />
          </SkiaImage>
        )}
      </Canvas>
      <CompanionSparkles level={sparkleLevel} size={size} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    width: '100%',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  sparkle: {
    position: 'absolute',
  },
});
