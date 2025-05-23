/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/a11y/SelectionManager.h"

#include "DocAccessible-inl.h"
#include "HyperTextAccessible.h"
#include "HyperTextAccessible-inl.h"
#include "nsAccessibilityService.h"
#include "nsAccUtils.h"
#include "nsCoreUtils.h"
#include "nsEventShell.h"
#include "nsFrameSelection.h"
#include "TextLeafRange.h"

#include "mozilla/PresShell.h"
#include "mozilla/dom/Selection.h"
#include "mozilla/dom/Element.h"

using namespace mozilla;
using namespace mozilla::a11y;
using mozilla::dom::Selection;

struct mozilla::a11y::SelData final {
  SelData(Selection* aSel, int32_t aReason, int32_t aGranularity)
      : mSel(aSel), mReason(aReason), mGranularity(aGranularity) {}

  RefPtr<Selection> mSel;
  int16_t mReason;
  int32_t mGranularity;

  NS_INLINE_DECL_REFCOUNTING(SelData)

 private:
  // Private destructor, to discourage deletion outside of Release():
  ~SelData() {}
};

SelectionManager::SelectionManager()
    : mCaretOffset(-1), mAccWithCaret(nullptr) {}

void SelectionManager::ClearControlSelectionListener() {
  // Remove 'this' registered as selection listener for the normal selection.
  if (mCurrCtrlNormalSel) {
    mCurrCtrlNormalSel->RemoveSelectionListener(this);
    mCurrCtrlNormalSel = nullptr;
  }
}

void SelectionManager::SetControlSelectionListener(dom::Element* aFocusedElm) {
  // When focus moves such that the caret is part of a new frame selection
  // this removes the old selection listener and attaches a new one for
  // the current focus.
  ClearControlSelectionListener();

  nsIFrame* controlFrame = aFocusedElm->GetPrimaryFrame();
  if (!controlFrame) return;

  const nsFrameSelection* frameSel = controlFrame->GetConstFrameSelection();
  NS_ASSERTION(frameSel, "No frame selection for focused element!");
  if (!frameSel) return;

  // Register 'this' as selection listener for the normal selection.
  Selection& normalSel = frameSel->NormalSelection();
  normalSel.AddSelectionListener(this);
  mCurrCtrlNormalSel = &normalSel;
}

void SelectionManager::AddDocSelectionListener(PresShell* aPresShell) {
  const nsFrameSelection* frameSel = aPresShell->ConstFrameSelection();

  // Register 'this' as selection listener for the normal selection.
  Selection& normalSel = frameSel->NormalSelection();
  normalSel.AddSelectionListener(this);
}

void SelectionManager::RemoveDocSelectionListener(PresShell* aPresShell) {
  const nsFrameSelection* frameSel = aPresShell->ConstFrameSelection();

  // Remove 'this' registered as selection listener for the normal selection.
  Selection& normalSel = frameSel->NormalSelection();
  normalSel.RemoveSelectionListener(this);

  if (mCurrCtrlNormalSel) {
    if (mCurrCtrlNormalSel->GetPresShell() == aPresShell) {
      // Remove 'this' registered as selection listener for the normal selection
      // if we are removing listeners for its PresShell.
      mCurrCtrlNormalSel->RemoveSelectionListener(this);
      mCurrCtrlNormalSel = nullptr;
    }
  }
}

void SelectionManager::ProcessTextSelChangeEvent(AccEvent* aEvent) {
  // Fire selection change event if it's not pure caret-move selection change,
  // i.e. the accessible has or had not collapsed selection. Also, it must not
  // be a collapsed selection on the container of a focused text field, since
  // the text field has an independent selection and will thus fire its own
  // selection events.
  AccTextSelChangeEvent* event = downcast_accEvent(aEvent);
  if (!event->IsCaretMoveOnly() &&
      !(event->mSel->IsCollapsed() && event->mSel != mCurrCtrlNormalSel &&
        FocusMgr() && FocusMgr()->FocusedLocalAccessible() &&
        FocusMgr()->FocusedLocalAccessible()->IsTextField())) {
    nsEventShell::FireEvent(aEvent);
  }

  // Fire caret move event if there's a caret in the selection.
  nsINode* caretCntrNode = nsCoreUtils::GetDOMNodeFromDOMPoint(
      event->mSel->GetFocusNode(), event->mSel->FocusOffset());
  if (!caretCntrNode) return;

  HyperTextAccessible* caretCntr = nsAccUtils::GetTextContainer(caretCntrNode);
  NS_ASSERTION(
      caretCntr,
      "No text container for focus while there's one for common ancestor?!");
  if (!caretCntr) return;

  Selection* selection = caretCntr->DOMSelection();

  // XXX Sometimes we can't get a selection for caretCntr, in that case assume
  // event->mSel is correct.
  if (!selection) selection = event->mSel;

  mCaretOffset = caretCntr->DOMPointToOffset(selection->GetFocusNode(),
                                             selection->FocusOffset());
  mAccWithCaret = caretCntr;
  if (mCaretOffset != -1) {
    TextLeafPoint caret = TextLeafPoint::GetCaret(caretCntr);
    RefPtr<AccCaretMoveEvent> caretMoveEvent =
        new AccCaretMoveEvent(caretCntr, mCaretOffset, selection->IsCollapsed(),
                              caret.mIsEndOfLineInsertionPoint,
                              event->GetGranularity(), aEvent->FromUserInput());
    nsEventShell::FireEvent(caretMoveEvent);
  }
}

NS_IMETHODIMP
SelectionManager::NotifySelectionChanged(dom::Document* aDocument,
                                         Selection* aSelection, int16_t aReason,
                                         int32_t aAmount) {
  if (NS_WARN_IF(!aDocument) || NS_WARN_IF(!aSelection)) {
    return NS_ERROR_INVALID_ARG;
  }

  DocAccessible* document = GetAccService()->GetDocAccessible(aDocument);

#ifdef A11Y_LOG
  if (logging::IsEnabled(logging::eSelection)) {
    logging::SelChange(aSelection, document, aReason);
  }
#endif

  if (document) {
    // Selection manager has longer lifetime than any document accessible,
    // so that we are guaranteed that the notification is processed before
    // the selection manager is destroyed.
    RefPtr<SelData> selData = new SelData(aSelection, aReason, aAmount);
    document->HandleNotification<SelectionManager, SelData>(
        this, &SelectionManager::ProcessSelectionChanged, selData);
  }

  return NS_OK;
}

void SelectionManager::ProcessSelectionChanged(SelData* aSelData) {
  Selection* selection = aSelData->mSel;
  if (!selection->GetPresShell()) return;

  const nsRange* range = selection->GetAnchorFocusRange();
  nsINode* cntrNode = nullptr;
  if (range) {
    cntrNode = range->GetClosestCommonInclusiveAncestor();
  }

  if (!cntrNode) {
    cntrNode = selection->GetFrameSelection()->GetAncestorLimiter();
    if (!cntrNode) {
      cntrNode = selection->GetPresShell()->GetDocument();
      NS_ASSERTION(aSelData->mSel->GetPresShell()->ConstFrameSelection() ==
                       selection->GetFrameSelection(),
                   "Wrong selection container was used!");
    }
  }

  HyperTextAccessible* text = nsAccUtils::GetTextContainer(cntrNode);
  if (!text) {
    // FIXME bug 1126649
    NS_ERROR("We must reach document accessible implementing text interface!");
    return;
  }

  if (selection->GetType() == SelectionType::eNormal) {
    RefPtr<AccEvent> event = new AccTextSelChangeEvent(
        text, selection, aSelData->mReason, aSelData->mGranularity);
    text->Document()->FireDelayedEvent(event);
  }
}

/* static */
bool SelectionManager::SelectionRangeChanged(SelectionType aType,
                                             const dom::AbstractRange& aRange) {
  if (aType != SelectionType::eSpellCheck &&
      aType != SelectionType::eTargetText &&
      aType != SelectionType::eHighlight) {
    // We don't need to handle range changes for this selection type.
    return false;
  }
  if (!GetAccService()) {
    return false;
  }
  nsINode* start = aRange.GetStartContainer();
  if (!start) {
    // This can happen when the document is being cleaned up.
    return false;
  }
  dom::Document* doc = start->OwnerDoc();
  MOZ_ASSERT(doc);
  nsINode* node = aRange.GetClosestCommonInclusiveAncestor();
  if (!node) {
    // Bug 1954751: This can happen when a Selection is being garbage collected,
    // but it's unclear exactly what other circumstances are involved.
    return false;
  }
  HyperTextAccessible* acc = nsAccUtils::GetTextContainer(node);
  if (!acc) {
    return true;
  }
  MOZ_ASSERT(acc->Document());
  acc->Document()->FireDelayedEvent(
      nsIAccessibleEvent::EVENT_TEXT_ATTRIBUTE_CHANGED, acc);
  if (IPCAccessibilityActive()) {
    TextLeafPoint::UpdateCachedTextOffsetAttributes(doc, aRange);
  }
  return true;
}

SelectionManager::~SelectionManager() = default;
