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

type BlobCompanionProps = {
  hue?: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
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

export function BlobCompanion({
  hue = 0,
  size = 340,
  style,
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
});
