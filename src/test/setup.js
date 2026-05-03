import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set([
    "animate",
    "custom",
    "drag",
    "dragConstraints",
    "dragControls",
    "dragElastic",
    "dragMomentum",
    "exit",
    "initial",
    "inherit",
    "layout",
    "layoutDependency",
    "layoutId",
    "onAnimationComplete",
    "onAnimationStart",
    "onLayoutAnimationComplete",
    "onLayoutAnimationStart",
    "transition",
    "variants",
    "viewport",
    "whileDrag",
    "whileFocus",
    "whileHover",
    "whileInView",
    "whileTap",
  ]);
  const components = new Map();

  const createMotionComponent = (element) => {
    const MotionComponent = React.forwardRef((props, ref) => {
      const { children, ...restProps } = /** @type {Record<string, any>} */ (props);
      const cleanProps = {};
      for (const [key, value] of Object.entries(restProps)) {
        if (!motionProps.has(key)) {
          cleanProps[key] = value;
        }
      }
      return React.createElement(element, { ...cleanProps, ref }, children);
    });

    MotionComponent.displayName = `MockMotion${typeof element === "string" ? element : "Component"}`;
    return MotionComponent;
  };

  const getMotionComponent = (element = "div") => {
    if (!components.has(element)) {
      components.set(element, createMotionComponent(element));
    }
    return components.get(element);
  };

  const motionFactory = (element) => getMotionComponent(element);
  const motion = new Proxy(motionFactory, {
    apply: (_target, _thisArg, [element]) => getMotionComponent(element),
    get: (_target, element) => {
      if (typeof element === "symbol") return undefined;
      return getMotionComponent(element);
    },
  });

  return {
    AnimatePresence: (props) => React.createElement(React.Fragment, null, props.children),
    motion,
  };
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
