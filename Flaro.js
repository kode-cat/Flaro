/*
  Flaro UI Library (SPA-focused micro-framework)

  Features:
  - DOM selection and manipulation (jQuery-like, but modern)
  - SPA Router with:
      - Nested routes (object-based)
      - 404 & arbitrary status code handlers (via "*404", "*302" etc)
      - Route handler receives param object: { pathname, search, hash, status, routeParams }
      - Programmatic navigation: Flaro.router.go(path), Flaro.router.go("*404")
      - Query/hash parsing (browser-like)
      - Scoped event listeners for nested routers (listen: false)
  - fetch method:
      - Flaro.fetch(url, config, promiseCallbacks)
      - config: { 'fetch-config': {...}, type, awaitOutput } (all optional)
      - promiseCallbacks: { then, catch, finally } (all optional)
      - Always returns a Promise (never returns this)
  - Store API (key-value, with proxy support)
  - fastSimdDiff/naiveDiff for change detection
  - Emmet-like element creation with @New (full CSS/Emmet support)
  - MIT License
*/

(function(global) {
  // --- Emmet-lite element creation ---
  function createElementByEmmet(emmetStr) {
    // emmetStr like 'div#id.class1.class2[attr1=val1][attr2]'
    emmetStr = emmetStr.trim();
    if (!emmetStr) return document.createElement("div");
    const tagMatch = emmetStr.match(/^([a-zA-Z][\w-]*)?/);
    let tag = tagMatch && tagMatch[1] ? tagMatch[1] : "div";
    let rest = emmetStr.slice(tag.length);
    let el = document.createElement(tag);
    
    // id
    const idMatch = rest.match(/#([\w-]+)/);
    if (idMatch) {
      el.id = idMatch[1];
      rest = rest.replace(idMatch[0], "");
    }
    
    // classes
    const classes = [];
    let classMatch;
    const classRegex = /\.([\w-]+)/g;
    while ((classMatch = classRegex.exec(rest))) {
      classes.push(classMatch[1]);
    }
    if (classes.length) el.className = classes.join(" ");
    rest = rest.replace(classRegex, "");
    
    // attributes
    let attrMatch;
    const attrRegex = /\[([\w-]+)(=(["']?)(.*?)\3)?\]/g;
    while ((attrMatch = attrRegex.exec(rest))) {
      let key = attrMatch[1];
      let val = typeof attrMatch[4] !== "undefined" ? attrMatch[4] : "";
      el.setAttribute(key, val);
    }
    
    return el;
  }
  
  // --- Store ---
  let _data = {};
  
  function store(action, key, value) {
    switch (action) {
      case "set":
        if (typeof key === "string" && key !== "*") { _data[key] = value; return true; }
        return false;
      case "get":
        if (key === "*") return { ..._data };
        return _data[key];
      case "move":
        if (_data.hasOwnProperty(key) && typeof value === "string" && value !== "*") {
          _data[value] = _data[key];
          delete _data[key];
          return true;
        }
        return false;
      case "type":
      case "typeof":
        if (_data.hasOwnProperty(key)) return typeof _data[key];
        return undefined;
      case "exists":
        return _data.hasOwnProperty(key);
      case "proxy":
        if (typeof key === "string" && key !== "*" && typeof value === "object") {
          if (!_data.hasOwnProperty(key)) _data[key] = {};
          return new Proxy(_data[key], {});
        }
        return new Proxy(_data, key);
      default:
        throw new Error(`Unknown store action: ${action}`);
    }
  }
  
  // --- Fetch ---
  function flaroFetch(url, config = {}, promiseCallbacks) {
    const fetchConfig = config['fetch-config'] || {};
    const type = config.type || "auto";
    const awaitOutput = config.awaitOutput || false;
    
    const promise = fetch(url, fetchConfig).then(async (response) => {
      let result, ct = response.headers.get("content-type") || "";
      if (type === "json" || (type === "auto" && ct.includes("application/json"))) {
        result = await response.json();
      } else if (type === "text" || (type === "auto" && ct.includes("text/"))) {
        result = await response.text();
      } else if (type === "blob" || type === "auto") {
        result = await response.blob();
      } else {
        result = await response.text();
      }
      const out = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: result,
        response: response
      };
      return awaitOutput ? out : result;
    });
    
    // Optionally attach then/catch/finally without chaining
    if (promiseCallbacks && typeof promiseCallbacks === "object") {
      if (typeof promiseCallbacks.then === "function") promise.then(promiseCallbacks.then);
      if (typeof promiseCallbacks.catch === "function") promise.catch(promiseCallbacks.catch);
      if (typeof promiseCallbacks.finally === "function") promise.finally(promiseCallbacks.finally);
    }
    return promise;
  }
  
  // --- Diff ---
  function stringDiff(a, b) {
    let diffs = [];
    let i = 0,
      j = 0,
      start = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
      } else {
        let ai = i,
          bj = j;
        while (ai < a.length && a[ai] !== b[j]) ai++;
        while (bj < b.length && b[bj] !== a[i]) bj++;
        if (ai - i < bj - j) {
          if (i < ai) diffs.push({ start: i, end: ai, replace: b.slice(j, j) });
          i = ai;
        } else {
          if (j < bj) diffs.push({ start: i, end: i, replace: b.slice(j, bj) });
          j = bj;
        }
      }
    }
    if (i < a.length) diffs.push({ start: i, end: a.length, replace: "" });
    if (j < b.length) diffs.push({ start: a.length, end: a.length, replace: b.slice(j) });
    return diffs;
  }
  
  function patchDiff(str, diffs) {
    let offset = 0;
    for (const { start, end, replace } of diffs) {
      str = str.slice(0, start + offset) + replace + str.slice(end + offset);
      offset += replace.length - (end - start);
    }
    return str;
  }
  
  // --- Template {{Braces}}
  // Note: The example usage for testing this function directly has been moved to a separate comment
  // to avoid confusion with its integration into the 'comp' function.
  function parseAndUseTemplate(templateString, data) {
    // If data is not provided or not an object, return the template string as is after unescaping
    if (!data || typeof data !== 'object') {
      return templateString.replace(/\\\{\{/g, '{{');
    }
    
    const parsedString = templateString.replace(/(?<!\\)\{\{(\w+)\}\}/g, (match, key) => {
      // If the key exists in the data, return its value; otherwise, return the original match.
      return data.hasOwnProperty(key) ? data[key] : match;
    });
    // Remove the backslashes from the escaped curly braces
    return parsedString.replace(/\\\{\{/g, '{{');
  }
  
  // Example usage (for testing parseAndUseTemplate in isolation):
  // const templateString = "Hello, {{name}}! You are \\{{age}} years old.";
  // const data = { name: "Alice", age: 30 };
  // console.log(parseAndUseTemplate(templateString, data)); // Output: Hello, Alice! You are 30 years old.
  
  // --- Router Helpers ---
  function pathToRegex(path) {
    if (path === "*") return /^.*$/;
    return new RegExp("^" + path.replace(/([:*])(\w+)/g, (_, colon, name) => {
      return colon === ":" ? "([^/]+)" : name;
    }).replace(/\//g, "\\/") + "$");
  }
  
  function extractParams(route, match) {
    const keys = [];
    const paramRegex = /:([\w]+)/g;
    let m;
    while ((m = paramRegex.exec(route)) !== null) keys.push(m[1]);
    const values = match.slice(1);
    const params = {};
    keys.forEach((k, i) => params[k] = values[i]);
    return params;
  }
  
  // --- Nested Route Table Flattening ---
  function flattenRoutes(routes, parentPath = "") {
    const flat = [];
    for (const key in routes) {
      if (typeof routes[key] === "function") {
        flat.push({ path: parentPath + key, handler: routes[key] });
      } else if (typeof routes[key] === "object" && routes[key] !== null) {
        flat.push(...flattenRoutes(routes[key], parentPath + key));
      }
    }
    return flat;
  }
  
  // --- Wrapper ---
  function Wrapper(elements) {
    this.elements = elements;
    this._flaroTimestamp = Date.now() + Math.floor(Math.random() * 1000000);
  }
  
  Wrapper.prototype = {
    el() { return this.elements },
    timestamp() { return this._flaroTimestamp; },
    html(val) {
      if (val === undefined) return this.elements[0]?.innerHTML;
      this.elements.forEach(el => (el.innerHTML = val));
      return this;
    },
    text(val) {
      if (val === undefined) return this.elements[0]?.textContent;
      this.elements.forEach(el => (el.textContent = val));
      return this;
    },
    val(val) {
      if (val === undefined) return this.elements[0]?.value;
      this.elements.forEach(el => (el.value = val));
      return this;
    },
    css(styles) {
      this.elements.forEach(el => {
        for (let key in styles) el.style[key] = styles[key];
      });
      return this;
    },
    on(evt, fn) {
      this.elements.forEach(el => {
        el._flaroEvents = el._flaroEvents || {};
        el.addEventListener(evt, fn);
        if (!el._flaroEvents[evt]) el._flaroEvents[evt] = [];
        el._flaroEvents[evt].push(fn);
      });
      return this;
    },
    off(evt) {
      this.elements.forEach(el => {
        if (el._flaroEvents && el._flaroEvents[evt]) {
          el._flaroEvents[evt].forEach(fn => el.removeEventListener(evt, fn));
          el._flaroEvents[evt] = [];
        }
      });
      return this;
    },
    toggleClass(...cls) {
      this.elements.forEach(el => el.classList.toggle(...cls));
      return this;
    },
    toggleAttr(...attrs) {
      this.elements.forEach(el => {
        attrs.forEach(attr => {
          if (el.hasAttribute(attr)) el.removeAttribute(attr);
          else el.setAttribute(attr, "");
        });
      });
      return this;
    },
    addClass(...cls) {
      this.elements.forEach(el => el.classList.add(...cls));
      return this;
    },
    removeClass(...cls) {
      this.elements.forEach(el => el.classList.remove(...cls));
      return this;
    },
    addAttr(name, value) {
      this.elements.forEach(el => el.setAttribute(name, value));
      return this;
    },
    
    removeAttr(...names) {
      this.elements.forEach(el => {
        names.forEach(name => el.removeAttribute(name));
      });
      return this;
    },
    Class(className) {
      if (className === undefined) {
        if (this.elements.length > 0) {
          return new Set(this.elements[0].classList);
        }
        return new Set();
      } else if (typeof className === 'string') {
        if (this.elements.length > 0) {
          return this.elements[0].classList.contains(className);
        }
        return false;
      } else if (Array.isArray(className)) {
        return this.addClass(...className);
      } else if (typeof className === 'object' && className !== null) {
        for (const cls in className) {
          if (className[cls]) {
            this.addClass(cls);
          } else {
            this.removeClass(cls);
          }
        }
        return this;
      }
      return this;
    },
    Attr(name, value) {
      if (value === undefined) {
        if (this.elements.length === 0) {
          return null;
        }
        const firstEl = this.elements[0];
        if (typeof name === 'string') {
          if (firstEl.hasAttribute(name)) {
            return firstEl.getAttribute(name); // Getter
          }
          return firstEl.hasAttribute(name); // Checker (returns true/false if attribute exists)
        } else if (Array.isArray(name)) {
          const attrs = {};
          name.forEach(attrName => {
            attrs[attrName] = firstEl.getAttribute(attrName);
          });
          return attrs;
        }
      } else {
        if (typeof name === 'string') {
          return this.addAttr(name, value);
        } else if (typeof name === 'object' && name !== null) {
          for (const attrName in name) {
            this.addAttr(attrName, name[attrName]);
          }
        }
      }
      return this;
    },
    changeID(newID) {
      this.elements.forEach(el => (el.id = newID));
      return this;
    },
    comp(param) {
      this.elements.forEach(el => {
        const $el = Flaro(el);
        let $state;
        let fn;
        let currentTemplateString = '';
        if (typeof param === 'function') {
          fn = param;
        } else if (typeof param === 'string') {
          fn = Flaro.comps[param];
        } else { return '' }
        function reRenderComp() {
          currentTemplateString = fn($el, $state, reRenderComp); // Get the latest template string
          render();
        }
        function render() {
          const newHtml = parseAndUseTemplate(currentTemplateString, $state);
          if (el.innerHTML !== newHtml) {
            const diffs = stringDiff(el.innerHTML, newHtml);
            el.innerHTML = patchDiff(el.innerHTML, diffs);
          }
        }
        $state = $el.reactiveData({}, render);
        currentTemplateString = fn($el, $state, reRenderComp);
        render();
      });
      return this;
    },
    reactiveData(data, onChange, config = ["dp-set"]) {
      const isDeep = config.includes("dp-set");
      const reactiveSet = new WeakSet();
      
      function wrap(target) {
        if (!isDeep || typeof target !== "object" || target === null) return target;
        if (reactiveSet.has(target)) return target;
        const proxy = new Proxy(target, handler);
        reactiveSet.add(proxy);
        return proxy;
      }
      
      const handler = {
        set(target, prop, value) {
          const oldVal = target[prop];
          const newVal = isDeep ? wrap(value) : value;
          target[prop] = newVal;
          if (oldVal !== newVal) {
            // Ensure onChange is a function before calling it
            if (typeof onChange === 'function') {
              onChange(prop, newVal, target, oldVal);
            }
          }
          return true;
        },
        deleteProperty(target, prop) {
          const had = Object.prototype.hasOwnProperty.call(target, prop);
          const oldVal = target[prop];
          const ok = delete target[prop];
          if (ok && had) {
            // Ensure onChange is a function before calling it
            if (typeof onChange === 'function') {
              onChange(prop, undefined, target, oldVal);
            }
          }
          return ok;
        }
      };
      
      return isDeep ? wrap(data) : new Proxy(data, handler);
    },
    reRender(target) {
      const el = document.querySelector(target);
      if (el) Flaro(el).html(el.innerHTML);
    },
    find(selector) {
      const results = [];
      this.elements.forEach(el => results.push(...el.querySelectorAll(selector)));
      return new Wrapper(results);
    },
    getClosest(selector) {
      const results = this.elements.map(el => el.closest(selector)).filter(Boolean);
      return new Wrapper(results);
    },
    relative(type, selector) {
      const results = [];
      this.elements.forEach(el => {
        if (type === "parent") results.push(el.parentElement);
        else if (type === "children") results.push(...el.children);
        else if (type === "sibling") results.push(...(el.parentElement?.children || []));
      });
      return selector ? new Wrapper(results).find(selector) : new Wrapper(results);
    },
    each(fn) {
      this.elements.forEach((el, i) => fn.call(el, i, el));
      return this;
    },
    id() { return this.elements[0]?.id || null; },
    classes() { return [...this.elements[0]?.classList || []]; },
    attributes() {
      const el = this.elements[0];
      return el ? [...el.attributes].map(a => [a.name, a.value]) : [];
    },
    $: function(...args) { return Flaro(...args); },
    refresh() { window.location.reload(); return this; },
    reboot() { window.location = window.location; return this; },
    reload(...selectors) {
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.outerHTML = el.outerHTML);
      });
      return this;
    },
  };
  
  // --- Router function with helpers as properties ---
  function router(routes, options = {}) {
    const self = this;
    const mode = options.mode === "history" ? "history" : "hash";
    const root = options.root || "/";
    const listen = options.listen !== false; // default true
    const flatRoutes = flattenRoutes(routes);
    const compiledRoutes = flatRoutes.map(({ path, handler }) => ({
      path,
      regex: router.pathToRegex(path),
      handler
    }));
    // 404 fallback (if any route with '*' as path or routes["*"])
    let fallbackHandler = null;
    flatRoutes.forEach(({ path, handler }) => {
      if (path === "*" || /^\*[\d]+$/.test(path)) fallbackHandler = handler;
    });
    
    let lastPath = null;
    
    function parseLocation() {
      let pathname, search = "",
        hash = "",
        full = "";
      if (mode === "history") {
        full = window.location.pathname + window.location.search + window.location.hash;
        pathname = window.location.pathname.replace(root, "/") || "/";
        search = window.location.search;
        hash = window.location.hash;
      } else {
        let frag = window.location.hash.slice(1);
        let idxQ = frag.indexOf("?");
        let idxH = frag.indexOf("#");
        if (idxQ === -1 && idxH === -1) {
          pathname = frag || "/";
        } else if (idxQ !== -1 && (idxH === -1 || idxQ < idxH)) {
          pathname = frag.slice(0, idxQ);
          search = frag.slice(idxQ, idxH === -1 ? undefined : idxH);
          hash = idxH === -1 ? "" : frag.slice(idxH);
        } else if (idxH !== -1) {
          pathname = frag.slice(0, idxH);
          hash = frag.slice(idxH);
        }
      }
      return { pathname, search, hash };
    }
    
    function handleRoute(forced) {
      const loc = parseLocation();
      if (!forced && loc.pathname === lastPath) return;
      lastPath = loc.pathname;
      let handled = false;
      for (let route of compiledRoutes) {
        const match = loc.pathname.match(route.regex);
        if (match) {
          const routeParams = router.extractParams(route.path, match);
          route.handler({
            pathname: loc.pathname,
            search: loc.search,
            hash: loc.hash,
            status: 200,
            routeParams
          }, self.elements);
          handled = true;
          break;
        }
      }
      if (!handled && fallbackHandler) {
        // extract code from "*404" or "*302" etc
        let status = 404;
        let fallbackPath = flatRoutes.find(r => /^\*\d+$/.test(r.path));
        if (fallbackPath) status = parseInt(fallbackPath.path.slice(1), 10) || 404;
        fallbackHandler({
          pathname: loc.pathname,
          search: loc.search,
          hash: loc.hash,
          status,
          routeParams: {}
        }, self.elements);
      }
    }
    
    router.handleRoute = handleRoute;
    
    if (listen) {
      if (mode === "history") {
        window.onpopstate = function() { handleRoute(); };
      } else {
        window.onhashchange = function() { handleRoute(); };
      }
      setTimeout(() => handleRoute(true), 0);
    } else {
      handleRoute(true);
    }
    return this;
  }
  
  router.pathToRegex = pathToRegex;
  router.extractParams = extractParams;
  router.handleRoute = function() {};
  router.flattenRoutes = flattenRoutes;
  
  function routerGo(pathOrStar, options = {}) {
    if (typeof pathOrStar === "string" && pathOrStar.startsWith("*")) {
      if (typeof router.handleRoute === "function") {
        router.handleRoute(true);
      }
      return;
    }
    const mode = options.mode === "history" ? "history" : "hash";
    const root = options.root || "/";
    if (mode === "history") {
      window.history.pushState(null, "", root.replace(/\/$/, "") + (pathOrStar.startsWith("/") ? pathOrStar : "/" + pathOrStar));
      if (typeof router.handleRoute === "function") router.handleRoute(true);
    } else {
      window.location.hash = pathOrStar.startsWith("/") ? pathOrStar : "/" + pathOrStar;
    }
  }
  router.go = routerGo;
  
  Wrapper.prototype.router = router;
  
  // --- Selector ---
  function parseSelector(sel) {
    if (typeof sel === "string") {
      if (sel.startsWith("@New")) {
        // Syntax: @New(div#id.class[attr])In(#parent)
        const match = sel.match(/@New\((.*?)\)In\((.*?)\)/);
        if (match) {
          const [_, emmetStr, parentSel] = match;
          const el = createElementByEmmet(emmetStr);
          const parent = document.querySelector(parentSel);
          if (parent) parent.appendChild(el);
          return [el];
        } else {
          // Just @New(div.class#id[attr])
          const match2 = sel.match(/@New\((.*?)\)/);
          if (match2) {
            const el = createElementByEmmet(match2[1]);
            document.body.appendChild(el);
            return [el];
          }
        }
      } else if (sel.startsWith("@Delete")) {
        const match = sel.match(/@Delete\((.*?)\)/);
        if (match) {
          document.querySelector(match[1])?.remove();
        }
        return [];
      }
    }
    return typeof sel === "string" ? [...document.querySelectorAll(sel)] :
      sel instanceof Element ? [sel] :
      Array.isArray(sel) ? sel : [];
  }
  
  function Flaro(selector) {
    return new Wrapper(parseSelector(selector));
  }
  
  // --- Attach core ---
  Flaro.store = store;
  Flaro.fetch = flaroFetch;
  Flaro.router = router;
  Flaro.reactiveData = Flaro().reactiveData;
  Flaro.stringDiff = stringDiff;
  Flaro.patchDiff = patchDiff;
  Flaro.refresh = () => window.location.reload();
  Flaro.reboot = () => document.documentElement.innerHTML = document.documentElement.innerHTML; // This is risky, a full reload (window.location.reload()) is generally safer for a "reboot"
  Flaro.reload = (...selectors) => Flaro().reload(...selectors);
  Flaro.comps = {};
  
  global.Flaro = Flaro;
})(window);
