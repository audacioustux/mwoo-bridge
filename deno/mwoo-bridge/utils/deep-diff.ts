// import * as R from "https://deno.land/x/rambda@9.4.2/mod.ts";

// export interface DiffOptions {
//   [key: string]: {
//     unique_by?: string;
//   };
// }

// function computeDiff(
//   leftVal: unknown,
//   rightVal: unknown,
//   currentKey: string | undefined,
//   options: DiffOptions | undefined,
// ): unknown {
//   // Handle arrays
//   if (Array.isArray(rightVal)) {
//     if (!Array.isArray(leftVal)) {
//       // If left is not an array then the whole right array is the diff.
//       return rightVal;
//     }
//     const meta = currentKey && options ? options[currentKey] : undefined;
//     if (meta?.unique_by) {
//       const uniqueBy = meta.unique_by;
//       const leftArray: unknown[] = leftVal;
//       const rightArray: unknown[] = rightVal;
//       const leftMap = new Map<unknown, unknown>();

//       for (const item of leftArray) {
//         if (typeof item !== "object" || item === null) {
//           throw new Error(
//             `Expected object elements in array "${currentKey}" (left).`,
//           );
//         }
//         const objItem = item as Record<string, unknown>;
//         const keyValue = objItem[uniqueBy];
//         if (keyValue === undefined) {
//           throw new Error(
//             `unique_by key "${uniqueBy}" not found in an element of left array "${currentKey}".`,
//           );
//         }
//         leftMap.set(keyValue, item);
//       }

//       const diffArray: unknown[] = [];
//       for (const item of rightArray) {
//         if (typeof item !== "object" || item === null) {
//           throw new Error(
//             `Expected object elements in array "${currentKey}" (right).`,
//           );
//         }
//         const objItem = item as Record<string, unknown>;
//         const keyValue = objItem[uniqueBy];
//         if (keyValue === undefined) {
//           throw new Error(
//             `unique_by key "${uniqueBy}" not found in an element of right array "${currentKey}".`,
//           );
//         }
//         const leftItem = leftMap.get(keyValue);
//         const diffItem = leftItem !== undefined
//           ? computeDiff(leftItem, item, currentKey, options)
//           : item;
//         // If there is any difference (or the element is new) add it to the diff array.
//         if (diffItem !== undefined && !R.equals(diffItem, {})) {
//           diffArray.push(item);
//         }
//       }
//       return diffArray.length > 0 ? diffArray : undefined;
//     } else {
//       // If no meta options, compare array elements by index.
//       const leftArray: unknown[] = leftVal;
//       const rightArray: unknown[] = rightVal;
//       if (leftArray.length !== rightArray.length) {
//         return rightVal;
//       }
//       const result: unknown[] = [];
//       for (let i = 0; i < rightArray.length; i++) {
//         result.push(
//           computeDiff(leftArray[i], rightArray[i], currentKey, options),
//         );
//       }
//       if (result.every((el) => el === undefined)) {
//         return undefined;
//       }
//       return result;
//     }
//   }

//   // Handle objects
//   if (typeof rightVal === "object" && rightVal !== null) {
//     if (typeof leftVal !== "object" || leftVal === null) {
//       return rightVal;
//     }
//     const rightObj = rightVal as Record<string, unknown>;
//     const leftObj = leftVal as Record<string, unknown>;
//     const diffObj: Record<string, unknown> = {};
//     // Only keys present on the right are considered.
//     for (const key of Object.keys(rightObj)) {
//       const diff = computeDiff(leftObj[key], rightObj[key], key, options);
//       if (diff !== undefined) {
//         diffObj[key] = diff;
//       }
//     }
//     return Object.keys(diffObj).length > 0 ? diffObj : undefined;
//   }

//   // Handle primitives and other types.
//   if (!R.equals(leftVal, rightVal)) {
//     return rightVal;
//   }
//   return undefined;
// }

// export function deepDiff<L, R>(
//   left: L,
//   right: R,
//   options?: DiffOptions,
// ): Record<string, unknown> {
//   const diff = computeDiff(left, right, undefined, options);
//   return diff === undefined ? {} : (diff as Record<string, unknown>);
// }

import * as R from "https://deno.land/x/rambda@9.4.2/mod.ts";

export interface DiffOptions {
  [key: string]: DiffOptions | {
    unique_by?: string; // compare array elements (objects) by this key
    preserve_order?: boolean; // replace deleted or undefined elements with undefined
    ignore_undefined?: boolean; // ignore undefined values in the diff
    ignore_keys?: string[]; // ignore these keys in the diff
    omit_unchanged_keys?: boolean; // omit keys with unchanged values in the diff
    omit_unchanged_elements?: boolean; // omit array elements with unchanged values in the diff
  };
}

function computeDiff(
  leftVal: unknown,
  rightVal: unknown,
  currentKey: string | undefined,
  options: DiffOptions | undefined,
): unknown {
  // Handle arrays
  if (Array.isArray(rightVal)) {
    if (!Array.isArray(leftVal)) {
      // If left is not an array then the whole right array is the diff.
      return rightVal;
    }
    const meta = currentKey && options ? options[currentKey] : undefined;
    if (meta && "unique_by" in meta) {
      const uniqueBy = meta.unique_by;
      const leftArray: unknown[] = leftVal;
      const rightArray: unknown[] = rightVal;
      const leftMap = new Map<unknown, unknown>();

      for (const item of leftArray) {
        if (typeof item !== "object" || item === null) {
          throw new Error(
            `Expected object elements in array "${currentKey}" (left).`,
          );
        }
        const objItem = item as Record<string, unknown>;
        const keyValue = objItem[uniqueBy as string];
        if (keyValue === undefined) {
          throw new Error(
            `unique_by key "${uniqueBy}" not found in an element of left array "${currentKey}".`,
          );
        }
        leftMap.set(keyValue, item);
      }

      const diffArray: unknown[] = [];
      for (const item of rightArray) {
        if (typeof item !== "object" || item === null) {
          throw new Error(
            `Expected object elements in array "${currentKey}" (right).`,
          );
        }
        const objItem = item as Record<string, unknown>;
        const keyValue = objItem[uniqueBy as string];
        if (keyValue === undefined) {
          throw new Error(
            `unique_by key "${uniqueBy}" not found in an element of right array "${currentKey}".`,
          );
        }
        const leftItem = leftMap.get(keyValue);
        const diffItem = leftItem !== undefined
          ? computeDiff(leftItem, item, currentKey, options)
          : item;
        // If there is any difference (or the element is new) add it to the diff array.
        if (diffItem !== undefined && !R.equals(diffItem, {})) {
          diffArray.push(item);
        }
      }
      return diffArray.length > 0 ? diffArray : undefined;
    } else {
      // If no meta options, compare array elements by index.
      const leftArray: unknown[] = leftVal;
      const rightArray: unknown[] = rightVal;
      if (leftArray.length !== rightArray.length) {
        return rightVal;
      }
      const result: unknown[] = [];
      for (let i = 0; i < rightArray.length; i++) {
        result.push(
          computeDiff(leftArray[i], rightArray[i], currentKey, options),
        );
      }
      if (result.every((el) => el === undefined)) {
        return undefined;
      }
      return result;
    }
  }

  // Handle objects
  if (typeof rightVal === "object" && rightVal !== null) {
    if (typeof leftVal !== "object" || leftVal === null) {
      return rightVal;
    }
    const rightObj = rightVal as Record<string, unknown>;
    const leftObj = leftVal as Record<string, unknown>;
    const diffObj: Record<string, unknown> = {};
    // Only keys present on the right are considered.
    for (const key of Object.keys(rightObj)) {
      const nestedOptions = options && options[key] as DiffOptions | undefined;
      const diff = computeDiff(leftObj[key], rightObj[key], key, nestedOptions);
      if (diff !== undefined) {
        diffObj[key] = diff;
      }
    }
    return Object.keys(diffObj).length > 0 ? diffObj : undefined;
  }

  // Handle primitives and other types.
  if (!R.equals(leftVal, rightVal)) {
    return rightVal;
  }
  return undefined;
}

export function deepDiff<L, R>(
  left: L,
  right: R,
  options?: DiffOptions,
): Record<string, unknown> {
  const diff = computeDiff(left, right, undefined, options);
  return diff === undefined ? {} : (diff as Record<string, unknown>);
}
