import "./native.css";
import { mountOfficeFrame } from "./index.ts";
const root = document.getElementById("office-native");
if (root === null) throw new Error("Office frame container is missing.");
mountOfficeFrame(root);
