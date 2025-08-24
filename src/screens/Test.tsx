import React, { useEffect, useState } from 'react';
import { View, Button, Image, Dimensions } from 'react-native';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-react-native';
import * as tflite from '@tensorflow/tfjs-tflite';
import { launchImageLibrary } from 'react-native-image-picker';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

const { width: screenWidth } = Dimensions.get('window');
const MODEL_INPUT = 640; // YOLOv5 input size

export default function YoloImage() {
  const [model, setModel] = useState<any>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<any[]>([]);

  // Load YOLOv5 TFLite model
  useEffect(() => {
    (async () => {
      await tf.ready();
      const m = await tflite.loadTFLiteModel(require('./assets/best.tflite'));
      setModel(m);
    })();
  }, []);

  // Pick an image
  const pickImage = async () => {
    const result = await launchImageLibrary({ mediaType: 'photo' });
    if (!result.didCancel && result.assets?.length > 0) {
      setImageUri(result.assets[0].uri || null);
      if (model) {
        runInference(result.assets[0].uri, model);
      }
    }
  };

  // Run inference
  const runInference = async (uri: string, m: any) => {
    const img = new Image();
    img.src = uri;

    img.onload = async () => {
      // Convert image to tensor
      let tensor = tf.browser.fromPixels(img)
        .resizeBilinear([MODEL_INPUT, MODEL_INPUT])
        .toFloat()
        .div(255.0)
        .expandDims(0);

      // Run prediction
      const output = m.predict(tensor) as tf.Tensor;
      const results = await output.array();

      // Example: decode [x1,y1,x2,y2,score,class]
      const newBoxes = results[0]
        .filter((d: any) => d[4] > 0.5) // confidence threshold
        .map((d: any) => ({
          x: d[0],
          y: d[1],
          width: d[2] - d[0],
          height: d[3] - d[1],
          score: d[4],
          classId: d[5],
        }));

      setBoxes(newBoxes);

      tf.dispose([tensor, output]);
    };
  };

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Button title="Pick Image" onPress={pickImage} />

      {imageUri && (
        <View>
          <Image
            source={{ uri: imageUri }}
            style={{ width: screenWidth, height: screenWidth }}
            resizeMode="contain"
          />
          <Svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: screenWidth,
              height: screenWidth,
            }}
          >
            {boxes.map((b, i) => (
              <React.Fragment key={i}>
                <Rect
                  x={b.x}
                  y={b.y}
                  width={b.width}
                  height={b.height}
                  stroke="red"
                  strokeWidth="2"
                  fill="none"
                />
                <SvgText x={b.x} y={b.y - 5} fill="red" fontSize="12">
                  {`id:${b.classId} ${(b.score * 100).toFixed(1)}%`}
                </SvgText>
              </React.Fragment>
            ))}
          </Svg>
        </View>
      )}
    </View>
  );
}
