import type { ComponentProps } from "react";
import { ShaderGradient, ShaderGradientCanvas } from "@shadergradient/react";
import ShaderCanvasLifecycle from "./shader-canvas-lifecycle";

const interstella = {
  type: "sphere",
  wireframe: false,
  shader: "defaults",
  uTime: 0,
  uSpeed: 0.3,
  uStrength: 0.3,
  uDensity: 0.8,
  uFrequency: 5.5,
  uAmplitude: 3.2,
  positionX: -0.1,
  positionY: 0,
  positionZ: 0,
  rotationX: 0,
  rotationY: 130,
  rotationZ: 70,
  color1: "#73bfc4",
  color2: "#ff810a",
  color3: "#8da0ce",
  reflection: 0.4,
  cAzimuthAngle: 270,
  cPolarAngle: 180,
  cDistance: 0.5,
  cameraZoom: 15.1,
  lightType: "env",
  brightness: 0.8,
  envPreset: "city",
  grain: "on",
  toggleAxis: false,
  zoomOut: false,
  enableTransition: false,
} as const;

/** Separate graphics chunk lets the public page and its inline still paint first. */
export default function ShaderRenderer(props: ComponentProps<typeof ShaderCanvasLifecycle>) {
  return (
    <ShaderGradientCanvas
      className="absolute inset-0"
      pixelDensity={1}
      fov={45}
      lazyLoad={false}
      pointerEvents="none"
    >
      <ShaderCanvasLifecycle {...props} />
      <ShaderGradient {...interstella} animate="off" />
    </ShaderGradientCanvas>
  );
}
