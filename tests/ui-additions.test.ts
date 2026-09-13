import test from "node:test";
import assert from "node:assert/strict";
import { draftApprovedPhotoProjection, draftPublicStallProjection } from "../src/shared/ui-additions";
import { draftPhotoFixture, draftStallFixture } from "../src/shared/ui-additions-fixtures";

test("publication selects only the approved derivative, never its containing upload", () => {
  const snapshot = draftApprovedPhotoProjection(draftPhotoFixture)!;
  assert.equal(snapshot.assetId, draftPhotoFixture.candidate!.assetId);
  assert.equal("originalUploadAssetId" in snapshot, false);
  assert.ok(Object.isFrozen(snapshot));
  const original = structuredClone(draftPhotoFixture);
  original.approval!.selected = "original";
  original.approval!.assetId = original.source.dishCropAssetId;
  assert.equal(draftApprovedPhotoProjection(original)!.assetId, original.source.dishCropAssetId);
  original.approval!.assetId = original.source.originalUploadAssetId;
  assert.equal(draftApprovedPhotoProjection(original), null);
});

test("source replacement, regeneration, or unverified pairing invalidates old approval", () => {
  const changes = [
    (state: typeof draftPhotoFixture) => { state.source.sourceVersion++; },
    (state: typeof draftPhotoFixture) => { state.candidate!.candidateVersion++; },
    (state: typeof draftPhotoFixture) => { state.source.pairing = "needs_review"; },
    (state: typeof draftPhotoFixture) => { state.source.quality = "fresh_photo_required"; },
    (state: typeof draftPhotoFixture) => { state.candidate!.sourceVersion++; },
    (state: typeof draftPhotoFixture) => { state.approval!.restaurantId = "00000000-0000-4000-8000-000000000099"; },
  ];
  for (const change of changes) {
    const state = structuredClone(draftPhotoFixture);
    change(state);
    assert.equal(draftApprovedPhotoProjection(state), null);
  }
});

test("an already projected publication snapshot does not follow subsequent draft edits", () => {
  const state = structuredClone(draftPhotoFixture);
  const published = draftApprovedPhotoProjection(state)!;
  state.candidate!.candidateVersion++;
  state.candidate!.assetId = state.source.dishCropAssetId;
  assert.equal(draftApprovedPhotoProjection(state), null);
  assert.equal(published.assetId, draftPhotoFixture.candidate!.assetId);
});

test("private contact and import URL do not enter the public projection implicitly", () => {
  const state = structuredClone(draftStallFixture);
  state.existingPageUrl = "https://example.invalid/private-review-link";
  assert.equal(draftPublicStallProjection(state).contactNumber, null);
  assert.equal("existingPageUrl" in draftPublicStallProjection(state), false);
  state.contact!.publish = true;
  assert.equal(draftPublicStallProjection(state).contactNumber, state.contact!.e164);
  const withoutConsent = { ...state, contact: { country: "SG", e164: state.contact!.e164 } };
  assert.equal(draftPublicStallProjection(withoutConsent).contactNumber, null);
});
