import { Image, ImageSource } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

const SLEEPING_FRAMES: ImageSource[] = [
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-01.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-02.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-03.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-04.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-05.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-06.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-07.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-08.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-09.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-10.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-11.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-12.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-13.png'),
  require('../assets/companions/slime/sleeping/slime-bounce-eyes-closed-14.png'),
];

const SLEEPING_FRAME_DURATION_MS = 1000 / 6;

type SlimeCompanionProps = {
  style?: StyleProp<ViewStyle>;
};

export function SlimeCompanion({ style }: SlimeCompanionProps) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const frameTimer = setInterval(() => {
      setFrameIndex((currentFrame) =>
        (currentFrame + 1) % SLEEPING_FRAMES.length
      );
    }, SLEEPING_FRAME_DURATION_MS);

    return () => clearInterval(frameTimer);
  }, []);

  return (
    <View
      accessibilityLabel="Sleeping slime companion"
      accessibilityRole="image"
      style={[styles.container, style]}
    >
      <Image
        contentFit="contain"
        source={SLEEPING_FRAMES[frameIndex]}
        style={styles.image}
        transition={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    height: 340,
    maxWidth: 340,
    width: '100%',
  },
  image: {
    height: '100%',
    width: '100%',
  },
});
