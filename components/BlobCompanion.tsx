import {
  Canvas,
  ColorMatrix,
  Image as SkiaImage,
  useImage,
} from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

const SPARKLE_IMAGE_SOURCE = require('../assets/companions/sparkle.png');
const EYES_OPEN_SOURCE = require('../assets/companions/blob/eyes-open.png');
const EYES_CLOSED_SOURCE = require('../assets/companions/blob/eyes-closed.png');
const HEADPHONES_SOURCE = require('../assets/companions/blob/headphones.png');
const BOOK_SOURCE = require('../assets/companions/blob/book.png');
const LAPTOP_SOURCE = require('../assets/companions/blob/laptop.png');

export type CompanionAccessory = 'default' | 'headphones' | 'book' | 'laptop';

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

// This set has no eyes baked in — eyes-open/eyes-closed are layered on top
// as a separate overlay so blinking can animate independently of the pose.
const AWAKE_FRAME_SOURCES = [
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-1.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-2.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-3.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-4.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-5.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-6.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-7.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-8.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-9.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-10.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-11.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-12.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-13.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-14.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-15.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-16.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-17.png'),
  require('../assets/companions/blob/awake/blob-bounce-no-eyes-18.png'),
];

// Plays as a one-shot burst on top of the sleeping frames, not looped.
const SLEEPING_Z_FRAME_SOURCES = [
  require('../assets/companions/blob/sleeping-z/z-1.png'),
  require('../assets/companions/blob/sleeping-z/z-2.png'),
  require('../assets/companions/blob/sleeping-z/z-3.png'),
  require('../assets/companions/blob/sleeping-z/z-4.png'),
  require('../assets/companions/blob/sleeping-z/z-5.png'),
  require('../assets/companions/blob/sleeping-z/z-6.png'),
  require('../assets/companions/blob/sleeping-z/z-7.png'),
  require('../assets/companions/blob/sleeping-z/z-8.png'),
  require('../assets/companions/blob/sleeping-z/z-9.png'),
];

const FRAME_DURATION_MS = 1000 / 6;

const BLINK_DURATION_MS = 150;
const BLINK_MIN_GAP_MS = 2000;
const BLINK_MAX_GAP_MS = 6000;

const Z_FRAME_DURATION_MS = 1000 / 12;
const Z_MIN_GAP_MS = 1000;
const Z_MAX_GAP_MS = 4000;

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
  { angleDeg: 355, radiusRatio: 0.58, sizeRatio: 0.11, delayMs: 0 },
  { angleDeg: 130, radiusRatio: 0.5, sizeRatio: 0.08, delayMs: 260 },
  { angleDeg: 220, radiusRatio: 0.46, sizeRatio: 0.13, delayMs: 520 },
  { angleDeg: 55, radiusRatio: 0.48, sizeRatio: 0.09, delayMs: 780 },
  { angleDeg: 300, radiusRatio: 0.34, sizeRatio: 0.1, delayMs: 130 },
  { angleDeg: 195, radiusRatio: 0.22, sizeRatio: 0.07, delayMs: 390 },
  { angleDeg: 170, radiusRatio: 0.66, sizeRatio: 0.07, delayMs: 650 },
  { angleDeg: 25, radiusRatio: 0.7, sizeRatio: 0.08, delayMs: 910 },
];

type BlobCompanionProps = {
  hue?: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** 0 (no sparkles) to 1 (fully sparkly) — how close to today's focus goal. */
  sparkleLevel?: number;
  /** True while locked in — swaps the sleeping loop for the awake one. */
  awake?: boolean;
  /** Only rendered while awake — sleeping has no accessories. */
  accessory?: CompanionAccessory;
};

export function createHueRotationMatrix(degrees: number) {
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
      <Image
        source={SPARKLE_IMAGE_SOURCE}
        style={{ width: sparkleSize, height: sparkleSize }}
        resizeMode="contain"
      />
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
  awake = false,
  accessory = 'default',
}: BlobCompanionProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const sleepingFrames = [
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
  const awakeFrames = [
    useImage(AWAKE_FRAME_SOURCES[0]),
    useImage(AWAKE_FRAME_SOURCES[1]),
    useImage(AWAKE_FRAME_SOURCES[2]),
    useImage(AWAKE_FRAME_SOURCES[3]),
    useImage(AWAKE_FRAME_SOURCES[4]),
    useImage(AWAKE_FRAME_SOURCES[5]),
    useImage(AWAKE_FRAME_SOURCES[6]),
    useImage(AWAKE_FRAME_SOURCES[7]),
    useImage(AWAKE_FRAME_SOURCES[8]),
    useImage(AWAKE_FRAME_SOURCES[9]),
    useImage(AWAKE_FRAME_SOURCES[10]),
    useImage(AWAKE_FRAME_SOURCES[11]),
    useImage(AWAKE_FRAME_SOURCES[12]),
    useImage(AWAKE_FRAME_SOURCES[13]),
    useImage(AWAKE_FRAME_SOURCES[14]),
    useImage(AWAKE_FRAME_SOURCES[15]),
    useImage(AWAKE_FRAME_SOURCES[16]),
    useImage(AWAKE_FRAME_SOURCES[17]),
  ];
  const frames = awake ? awakeFrames : sleepingFrames;
  const hueMatrix = useMemo(() => createHueRotationMatrix(hue), [hue]);

  // Sleeping frames have eyes baked in (closed) — this overlay only applies
  // while awake, where the body frames were drawn with no eyes at all.
  const eyesOpenImage = useImage(EYES_OPEN_SOURCE);
  const eyesClosedImage = useImage(EYES_CLOSED_SOURCE);
  const headphonesImage = useImage(HEADPHONES_SOURCE);
  const bookImage = useImage(BOOK_SOURCE);
  const laptopImage = useImage(LAPTOP_SOURCE);
  const accessoryImage =
    accessory === 'headphones'
      ? headphonesImage
      : accessory === 'book'
      ? bookImage
      : accessory === 'laptop'
      ? laptopImage
      : null;
  const [isBlinking, setIsBlinking] = useState(false);

  useEffect(() => {
    if (!awake) {
      setIsBlinking(false);
      return;
    }

    let closeTimer: ReturnType<typeof setTimeout>;
    let openTimer: ReturnType<typeof setTimeout>;

    const scheduleNextBlink = () => {
      const gap = BLINK_MIN_GAP_MS + Math.random() * (BLINK_MAX_GAP_MS - BLINK_MIN_GAP_MS);
      closeTimer = setTimeout(() => {
        setIsBlinking(true);
        openTimer = setTimeout(() => {
          setIsBlinking(false);
          scheduleNextBlink();
        }, BLINK_DURATION_MS);
      }, gap);
    };

    scheduleNextBlink();
    return () => {
      clearTimeout(closeTimer);
      clearTimeout(openTimer);
    };
  }, [awake]);

  // Rendered as a plain RN Image (not Skia), with opacity derived directly
  // from zFrameIndex in the same render rather than via a separate Animated
  // value — an Animated.Value's updates are applied via setNativeProps
  // outside React's normal render/commit cycle, so even with the native
  // driver off it could still land a beat before or after the frame-index
  // state actually re-rendered the <Image> source, making the burst appear
  // to start mid-way instead of cleanly at frame 0. Deriving both the frame
  // and the opacity from one integer in one render makes that impossible.
  // -1 means no burst is currently playing.
  const [zFrameIndex, setZFrameIndex] = useState(-1);

  useEffect(() => {
    if (awake) {
      setZFrameIndex(-1);
      return;
    }

    let gapTimer: ReturnType<typeof setTimeout>;
    let playbackTimer: ReturnType<typeof setInterval>;

    const scheduleNextZ = () => {
      const gap = Z_MIN_GAP_MS + Math.random() * (Z_MAX_GAP_MS - Z_MIN_GAP_MS);
      gapTimer = setTimeout(() => {
        let frame = 0;
        setZFrameIndex(0);

        playbackTimer = setInterval(() => {
          frame += 1;
          if (frame >= SLEEPING_Z_FRAME_SOURCES.length) {
            clearInterval(playbackTimer);
            setZFrameIndex(-1);
            scheduleNextZ();
            return;
          }
          setZFrameIndex(frame);
        }, Z_FRAME_DURATION_MS);
      }, gap);
    };

    scheduleNextZ();
    return () => {
      clearTimeout(gapTimer);
      clearInterval(playbackTimer);
    };
  }, [awake]);

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

  // Reset to frame 0 on every sleeping/awake switch so the cycle restarts
  // cleanly instead of continuing from wherever the other loop left off.
  useEffect(() => {
    setFrameIndex(0);
  }, [awake]);

  useEffect(() => {
    const frameCount = awake ? AWAKE_FRAME_SOURCES.length : SLEEPING_FRAME_SOURCES.length;
    const frameTimer = setInterval(() => {
      setFrameIndex((currentFrame) => (currentFrame + 1) % frameCount);
    }, FRAME_DURATION_MS);

    return () => clearInterval(frameTimer);
  }, [awake]);

  return (
    <Animated.View
      accessibilityLabel={awake ? 'Awake blob companion, locked in' : 'Sleeping blob companion'}
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
        {awake && (isBlinking ? eyesClosedImage : eyesOpenImage) && (
          <SkiaImage
            fit="contain"
            height={size}
            image={isBlinking ? eyesClosedImage : eyesOpenImage}
            width={size}
            x={0}
            y={0}
          >
            <ColorMatrix matrix={hueMatrix} />
          </SkiaImage>
        )}
        {awake && accessoryImage && (
          <SkiaImage
            fit="contain"
            height={size}
            image={accessoryImage}
            width={size}
            x={0}
            y={0}
          />
        )}
      </Canvas>
      {!awake && zFrameIndex >= 0 && (
        <View
          pointerEvents="none"
          style={[
            styles.sleepingZWrap,
            {
              width: size,
              height: size,
              opacity: 1 - zFrameIndex / (SLEEPING_Z_FRAME_SOURCES.length - 1),
            },
          ]}
        >
          <Image
            source={SLEEPING_Z_FRAME_SOURCES[zFrameIndex]}
            style={styles.sleepingZImage}
            resizeMode="contain"
          />
        </View>
      )}
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
  sleepingZWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  sleepingZImage: {
    width: '100%',
    height: '100%',
  },
});
