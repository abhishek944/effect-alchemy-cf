import { useEffect, useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh, MeshPhysicalMaterial } from "three";

type Props = {
  id: string;
  running: boolean;
  animate: boolean;
  onReady: () => void;
  onFailure: () => void;
};

export default function ShaderCanvasLifecycle({ id, running, animate, onReady, onFailure }: Props) {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const setFrameloop = useThree((state) => state.setFrameloop);
  const phase = useRef(0);
  const ready = useRef(false);

  useLayoutEffect(() => {
    // Retain the scene, but do not continuously draw hidden/offscreen/static fields.
    setFrameloop(running ? "always" : "demand");
  }, [running, setFrameloop]);

  useEffect(() => {
    const container = renderer.domElement.closest("#gradientCanvas");
    if (container) container.id = id;
    renderer.domElement.addEventListener("webglcontextlost", onFailure);
    return () => renderer.domElement.removeEventListener("webglcontextlost", onFailure);
  }, [renderer, id, onFailure]);

  useFrame((_, delta) => {
    // The package's private wall clock resets on animate changes and jumps after pauses.
    // Fiber owns scheduling; retain only the phase, including across material recreation.
    if (animate) phase.current += delta;
    const mesh = scene.getObjectByName("shadergradient-mesh");
    if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshPhysicalMaterial)) return;
    const uniform: unknown = mesh.material.userData.uTime;
    if (typeof uniform === "object" && uniform !== null && "value" in uniform) {
      uniform.value = phase.current;
    }
  }, -1);

  // The pinned package's grain pass renders at priority 1. Reveal only after that pass
  // has drawn with its environment, not merely after the canvas element was inserted.
  useFrame(() => {
    if (!ready.current && scene.environment && renderer.info.render.calls > 0) {
      ready.current = true;
      onReady();
    }
  }, 2);
  return null;
}
