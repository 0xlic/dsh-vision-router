// DSH's admission layer (session prompt, subagent, ACP, and the built-in
// image tools) consults the public `llm.resolveModelInfo`. Dispatch resolves
// its own model info internally through `adapter.prepareCall`, so widening
// only this public view lets whitelisted text-only models receive image
// prompts, while the request layer still projects those images to
// `[image omitted ...; attachment sha256:…]` placeholders the model resolves
// through vision_read.
export function installAdmissionBypass(llm, isWhitelisted) {
  if (!llm || typeof llm.resolveModelInfo !== 'function') return () => {};
  const owned = Object.prototype.hasOwnProperty.call(llm, 'resolveModelInfo');
  const previous = llm.resolveModelInfo;
  let active = true;
  const wrapper = async (provider, model, signal) => {
    const info = await previous.call(llm, provider, model, signal);
    if (!active || !info) return info;
    // A model without declared modalities already passes image admission, and
    // natively image-capable models need no correction; widen text-only ones.
    const modalities = info.inputModalities;
    if (modalities === undefined || modalities.includes('image')) return info;
    if (!isWhitelisted(provider, model)) return info;
    return { ...info, inputModalities: [...modalities, 'image'] };
  };
  llm.resolveModelInfo = wrapper;
  return () => {
    // Even when a later wrapper chained on top, ours degrades to pass-through.
    active = false;
    if (llm.resolveModelInfo === wrapper) {
      if (owned) llm.resolveModelInfo = previous;
      else delete llm.resolveModelInfo;
    }
  };
}
