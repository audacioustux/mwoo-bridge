import { assertObjectMatch } from "@std/assert";
import { deepDiff } from "./deep-diff.ts";

Deno.test(function changeValue() {
  assertObjectMatch(deepDiff({ a: 1 }, { a: 2 }), {
    a: 2,
  });
});

Deno.test(function addEntry() {
  assertObjectMatch(deepDiff({ a: 1 }, { a: 1, b: 2 }), {
    b: 2,
  });
});

Deno.test(function removeEntry() {
  assertObjectMatch(deepDiff({ a: 1, b: 2 }, { a: 1 }), {
    b: undefined,
  });
});

Deno.test(function changeNestedValue() {
  assertObjectMatch(deepDiff({ a: { b: 1 } }, { a: { b: 2 } }), {
    a: { b: 2 },
  });
});

Deno.test(function addNestedEntry() {
  assertObjectMatch(deepDiff({ a: { b: 1 } }, { a: { b: 1, c: 2 } }), {
    a: { c: 2 },
  });
});

Deno.test(function changeNestedValue_omitUnchangedKeys() {
  assertObjectMatch(
    deepDiff({ a: { b: 1, c: 2 }, d: { e: 3, f: 4 } }, {
      a: { b: 2, c: 2 },
      d: { e: 3, f: 5 },
    }, {
      a: {
        // default: true for objects
        omit_unchanged_keys: false,
      },
    }),
    {
      a: { b: 2, c: 2 },
      d: {
        f: 5,
      },
    },
  );
});

Deno.test(function removeNestedEntry() {
  assertObjectMatch(deepDiff({ a: { b: 1, c: 2 } }, { a: { b: 1 } }), {
    a: { c: undefined },
  });
});

Deno.test(function changeArrayValue() {
  assertObjectMatch(deepDiff({ a: [1] }, { a: [2] }), {
    a: [2],
  });
});

Deno.test(function addArrayEntry() {
  assertObjectMatch(deepDiff({ a: [1] }, { a: [1, 2] }), {
    a: [1, 2],
  });
});

Deno.test(function removeArrayEntry() {
  assertObjectMatch(deepDiff({ a: [1, 2] }, { a: [1] }), {
    a: [1],
  });
});

Deno.test(function changeArrayElement() {
  assertObjectMatch(deepDiff({ a: [1, 2] }, { a: [1, 3] }), {
    a: [1, 3],
  });
});

Deno.test(function changeArrayElement_2() {
  assertObjectMatch(deepDiff({ a: [1, 2, 3] }, { a: [1, 3, 2] }), {
    a: [1, 3, 2],
  });
});

Deno.test(function changeArrayElementWithObject() {
  assertObjectMatch(deepDiff({ a: [{ b: 1 }] }, { a: [{ b: 2 }] }), {
    a: [{ b: 2 }],
  });
});

Deno.test(function changeArrayElementWithObjectByKey() {
  assertObjectMatch(
    deepDiff({ a: [{ id: 1, val: "foo" }] }, { a: [{ id: 1, val: "baz" }] }, {
      a: {
        // compare array elements (objects) by this key
        unique_by: "id",
      },
    }),
    {
      a: [{ id: 1, val: "baz" }],
    },
  );
});

Deno.test(function changeArrayElementWithObjectByKey_2() {
  assertObjectMatch(
    deepDiff({ a: [{ id: 1, val: "foo" }, { id: 2, val: "bar" }] }, {
      a: [{ id: 1, val: "baz" }, { id: 2, val: "bar" }],
    }, {
      a: {
        unique_by: "id",
      },
    }),
    {
      a: [{ id: 1, val: "baz" }],
    },
  );
});

Deno.test(function changeArrayElementWithObjectByKey_3() {
  assertObjectMatch(
    deepDiff({ a: [{ id: 1, val: "foo" }, { id: 2, val: "bar" }] }, {
      a: [{ id: 1, val: "baz" }, { id: 2, val: "baz" }],
    }, {
      a: {
        unique_by: "id",
      },
    }),
    {
      a: [{ id: 1, val: "baz" }, { id: 2, val: "baz" }],
    },
  );
});

Deno.test(function changeArrayElementWithObjectByKey_3_omitUnchangedElements() {
  assertObjectMatch(
    deepDiff({ a: [{ id: 1, val: "foo" }, { id: 2, val: "bar" }] }, {
      a: [{ id: 1, val: "baz" }, { id: 2, val: "baz" }],
    }, {
      a: {
        unique_by: "id",
        // default: true for arrays with unique_by
        // default: false for arrays without unique_by
        // default: true for objects
        omit_unchanged_elements: false,
      },
    }),
    {
      a: [{ id: 1, val: "baz" }, { id: 2, val: "baz" }],
    },
  );
});

Deno.test(function changeArrayElementWithObjectByKey_4() {
  assertObjectMatch(
    deepDiff({ a: [{ id: 1, val1: "foo", val2: "bar" }] }, {
      a: [{ id: 1, val1: "foo", val2: "baz" }],
    }, {
      a: {
        unique_by: "id",
      },
    }),
    {
      a: [{ id: 1, val1: "foo", val2: "baz" }],
    },
  );
});

Deno.test(function changeArrayElementWithObjectByKey_4_omitUnchangedKeys() {
  assertObjectMatch(
    deepDiff({ a: [{ id: 1, val1: "foo", val2: "bar" }] }, {
      a: [{ id: 1, val1: "foo", val2: "baz" }],
    }, {
      a: {
        unique_by: "id",
        // default: false for array elements (objects)
        omit_unchanged_keys: true,
      },
    }),
    {
      a: [{ id: 1, val2: "baz" }],
    },
  );
});

Deno.test(function changeArrayElementWithObjectByKey_4_omitUnchangedKeys() {
  assertObjectMatch(
    deepDiff({ a: [{ id: 1, val1: "foo", val2: "bar" }] }, {
      a: [{ id: 1, val1: "foo", val2: "baz" }],
    }, {
      a: {
        unique_by: "id",
        omit_unchanged_keys: true,
      },
    }),
    {
      a: [{ id: 1, val2: "baz" }],
    },
  );
});

Deno.test(function changeArrayElementWithObjectByKey_4_ignoreKeys() {
  assertObjectMatch(
    deepDiff({ a: [{ id: 1, val1: "foo", val2: "bar" }] }, {
      a: [{ id: 1, val1: "foo", val2: "baz" }],
    }, {
      a: {
        unique_by: "id",
        // ignore these keys
        ignore_keys: ["val2"],
      },
    }),
    {},
  );
});
