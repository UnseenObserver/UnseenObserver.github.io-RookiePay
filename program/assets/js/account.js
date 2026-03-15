import { auth, db } from './firebase-config.js';
import {
  buildDisplayName,
  findFamilyByInviteCode,
  generateInviteCode,
  getDefaultMemberPermissions,
  getFamilyById,
  getRoleLabel,
  listFamilyMembers,
  normalizeInviteCode
} from './family.js';
import {
  EmailAuthProvider,
  deleteUser,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updateEmail,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const elements = {
  form: document.getElementById('account-form'),
  firstNameInput: document.getElementById('first-name'),
  lastNameInput: document.getElementById('last-name'),
  usernameInput: document.getElementById('username'),
  emailInput: document.getElementById('email'),
  saveButton: document.getElementById('save-btn'),
  resetPasswordButton: document.getElementById('reset-password-btn'),
  roleBadge: document.getElementById('account-role-badge'),
  pageMessage: document.getElementById('page-message'),
  accountMessage: document.getElementById('account-message'),
  familySectionCopy: document.getElementById('family-section-copy'),
  familyMessage: document.getElementById('family-message'),
  roleSwitchRow: document.getElementById('role-switch-row'),
  roleSwitchToggleButton: document.getElementById('role-switch-toggle'),
  roleSwitchPanel: document.getElementById('role-switch-panel'),
  roleSwitchSelect: document.getElementById('role-switch-select'),
  roleSwitchVerifyInput: document.getElementById('role-switch-verify-input'),
  roleSwitchCancelButton: document.getElementById('role-switch-cancel'),
  roleSwitchApplyButton: document.getElementById('role-switch-apply'),
  parentFamilyPanel: document.getElementById('parent-family-panel'),
  childFamilyPanel: document.getElementById('child-family-panel'),
  soloFamilyPanel: document.getElementById('solo-family-panel'),
  familyNameDisplay: document.getElementById('family-name-display'),
  familyInviteDisplay: document.getElementById('family-invite-display'),
  copyInviteButton: document.getElementById('copy-invite-btn'),
  regenerateInviteButton: document.getElementById('regenerate-invite-btn'),
  joinParentCodeInput: document.getElementById('join-parent-code'),
  joinParentButton: document.getElementById('join-parent-btn'),
  familyParentsList: document.getElementById('family-parents-list'),
  familyChildrenList: document.getElementById('family-children-list'),
  childFamilyName: document.getElementById('child-family-name'),
  childFamilyStatus: document.getElementById('child-family-status'),
  childFamilyCopy: document.getElementById('child-family-copy'),
  profileSection: document.querySelector('.profile-section'),
  openPhotoModalButton: document.getElementById('open-photo-modal'),
  profilePhotoPreview: document.getElementById('profile-photo-preview'),
  profilePhotoModal: document.getElementById('profile-photo-modal'),
  profilePhotoModalCopy: document.getElementById('profile-photo-modal-copy'),
  profilePhotoInput: document.getElementById('profile-photo-input'),
  profilePhotoCropper: document.getElementById('profile-photo-cropper'),
  profilePhotoCanvas: document.getElementById('profile-photo-canvas'),
  profilePhotoControls: document.getElementById('profile-photo-controls'),
  profileAvatarPicker: document.getElementById('profile-avatar-picker'),
  profileAvatarOptions: document.querySelectorAll('.profile-avatar-option'),
  profilePhotoZoomInput: document.getElementById('profile-photo-zoom'),
  profilePhotoOffsetXInput: document.getElementById('profile-photo-offset-x'),
  profilePhotoOffsetYInput: document.getElementById('profile-photo-offset-y'),
  profilePhotoApplyButton: document.getElementById('profile-photo-apply-btn'),
  profilePhotoResetButton: document.getElementById('profile-photo-reset-btn'),
  openDeleteAccountModalButton: document.getElementById('open-delete-account-modal'),
  deleteAccountModal: document.getElementById('delete-account-modal'),
  deleteAccountPasswordInput: document.getElementById('delete-account-password'),
  deleteAccountMessage: document.getElementById('delete-account-message'),
  confirmDeleteAccountButton: document.getElementById('confirm-delete-account')
};

let currentUser = null;
let currentUserProfile = null;
let currentFamily = null;
let currentFamilyMembers = [];
let accountMessageTimeoutId = null;
let familyMessageTimeoutId = null;
let photoSourceImage = null;
let pendingProfilePhotoDataUrl = '';
let pendingProfileAvatarName = '';
let pendingProfilePhotoObjectUrl = '';
let hasUnappliedCrop = false;

const PRESET_AVATAR_SOURCES = {
  astronaut: '../assets/images/avatars/avatar-1.svg',
  'blue-cap': '../assets/images/avatars/avatar-2.svg',
  'green-hoodie': '../assets/images/avatars/avatar-3.svg',
  'star-glasses': '../assets/images/avatars/avatar-4.svg',
  'orange-playful': '../assets/images/avatars/avatar-5.svg',
  superhero: '../assets/images/avatars/avatar-6.svg'
};

const PROFILE_PHOTO_SIZE = 192;
const PROFILE_PHOTO_JPEG_QUALITY = 0.78;

const cropState = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0
};

function getDefaultProfilePhotoUrl() {
  return '../assets/images/default-profile.svg';
}

function getPresetAvatarSource(avatarName = '') {
  const normalizedName = String(avatarName || '').trim();
  return PRESET_AVATAR_SOURCES[normalizedName] || '';
}

function getLocalProfilePhotoKey(userId) {
  return `mf_profile_photo_${userId}`;
}

function getLocalProfilePhoto(userId) {
  if (!userId) {
    return '';
  }

  return localStorage.getItem(getLocalProfilePhotoKey(userId)) || '';
}

function saveLocalProfilePhoto(userId, dataUrl) {
  if (!userId) {
    return;
  }

  if (!dataUrl) {
    localStorage.removeItem(getLocalProfilePhotoKey(userId));
    return;
  }

  localStorage.setItem(getLocalProfilePhotoKey(userId), dataUrl);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setActiveAvatarOption(selectedAvatarName = '') {
  if (!elements.profileAvatarOptions || elements.profileAvatarOptions.length === 0) {
    return;
  }

  const normalizedSelected = String(selectedAvatarName || '').trim();

  elements.profileAvatarOptions.forEach((button) => {
    const optionName = String(button.dataset.avatarName || '').trim();
    const isActive = Boolean(normalizedSelected) && optionName === normalizedSelected;

    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function resolveProfilePhotoSource(photoURL = '', photoAvatarName = '') {
  const presetSource = getPresetAvatarSource(photoAvatarName);

  if (presetSource) {
    return presetSource;
  }

  const trimmedPhotoUrl = String(photoURL || '').trim();
  if (trimmedPhotoUrl) {
    return trimmedPhotoUrl;
  }

  return '';
}

function setProfilePhotoPreview(photoURL, photoAvatarName = '') {
  if (!elements.profilePhotoPreview) {
    return;
  }

  const resolvedSource = resolveProfilePhotoSource(photoURL, photoAvatarName);
  elements.profilePhotoPreview.src = resolvedSource || getDefaultProfilePhotoUrl();
  setActiveAvatarOption(photoAvatarName || '');
}

function setPhotoModalCopy(text) {
  if (!elements.profilePhotoModalCopy) {
    return;
  }

  elements.profilePhotoModalCopy.textContent = text;
}

function setRoleBadge(role = 'solo') {
  if (!elements.roleBadge) {
    return;
  }

  elements.roleBadge.textContent = getRoleLabel(role);
  elements.roleBadge.className = `role-badge role-badge-${role}`;
}

function setFamilyMessage(text = '', type = '') {
  const el = elements.familyMessage;

  if (!el) {
    return;
  }

  if (familyMessageTimeoutId) {
    clearTimeout(familyMessageTimeoutId);
    familyMessageTimeoutId = null;
  }

  el.textContent = text;
  el.className = 'page-message family-inline-message';

  if (type) {
    el.classList.add(type);
  }

  if (text) {
    familyMessageTimeoutId = setTimeout(() => {
      el.textContent = '';
      el.className = 'page-message family-inline-message';
      familyMessageTimeoutId = null;
    }, 3500);
  }
}

function setFamilySectionMode(role = 'solo') {
  elements.parentFamilyPanel.hidden = role !== 'parent';
  elements.childFamilyPanel.hidden = role !== 'child';
  elements.soloFamilyPanel.hidden = role !== 'solo';
}

function setRoleSwitchPanelOpen(show) {
  if (!elements.roleSwitchPanel || !elements.roleSwitchToggleButton) {
    return;
  }

  elements.roleSwitchPanel.hidden = !show;
  elements.roleSwitchToggleButton.setAttribute('aria-expanded', show ? 'true' : 'false');

  if (show) {
    elements.roleSwitchVerifyInput.value = '';
    elements.roleSwitchVerifyInput.focus();
  }
}

function renderRoleSwitchControl(role = 'solo') {
  // Role changes are intentionally restricted from this UI for child accounts.
  const canShow = role === 'solo' || role === 'parent';

  if (elements.roleSwitchRow) {
    elements.roleSwitchRow.hidden = !canShow;
  }

  if (!canShow) {
    setRoleSwitchPanelOpen(false);
    return;
  }

  if (elements.roleSwitchSelect) {
    if (role === 'parent') {
      elements.roleSwitchSelect.value = 'parent';
    } else if (role === 'child') {
      elements.roleSwitchSelect.value = 'child';
    }
  }
}

function renderParentFamilyPanel() {
  const familyName = currentFamily?.name || buildDisplayName(currentUserProfile?.firstName, currentUserProfile?.lastName) || 'Parent Account';
  const inviteCode = currentFamily?.inviteCode || '------';
  const linkedParents = currentFamilyMembers.filter((member) => member.role === 'parent' && member.uid !== currentUser?.uid && member.status === 'active');
  const childMembers = currentFamilyMembers.filter((member) => member.role === 'child' && member.status === 'active');

  elements.familySectionCopy.textContent = 'Manage your invite code, linked adults, linked children, and parent portal permissions.';
  elements.familyNameDisplay.textContent = familyName;
  elements.familyInviteDisplay.textContent = inviteCode;

  if (linkedParents.length === 0) {
    elements.familyParentsList.innerHTML = '<li class="empty-state">No linked parents yet.</li>';
  } else {
    elements.familyParentsList.innerHTML = linkedParents.map((member) => {
      const safeName = escapeHtml(member.displayName || member.email || 'Parent Account');
      const safeEmail = escapeHtml(member.email || 'No email available');

      return `
        <li class="family-member-card compact-family-member-card">
          <div class="family-member-header">
            <div>
              <strong>${safeName}</strong>
              <p>${safeEmail}</p>
            </div>
          </div>
        </li>
      `;
    }).join('');
  }

  if (childMembers.length === 0) {
    elements.familyChildrenList.innerHTML = '<li class="empty-state">No children linked yet. Share your invite code to connect one.</li>';
    return;
  }

  elements.familyChildrenList.innerHTML = childMembers.map((member) => {
    const permissions = member.permissions || {};
    const safeName = escapeHtml(member.displayName || member.email || 'Child Account');
    const safeEmail = escapeHtml(member.email || 'No email available');

    return `
      <li class="family-member-card">
        <div class="family-member-header">
          <div>
            <strong>${safeName}</strong>
            <p>${safeEmail}</p>
          </div>
          <button type="button" class="btn-delete" data-family-action="remove-child" data-member-id="${member.uid}">Remove</button>
        </div>
        <div class="family-permissions-grid">
          <label class="family-permission-toggle">
            <input type="checkbox" data-family-action="toggle-permission" data-member-id="${member.uid}" data-permission="canViewDashboardSummary" ${permissions.canViewDashboardSummary ? 'checked' : ''} />
            <span>Summary</span>
          </label>
          <label class="family-permission-toggle">
            <input type="checkbox" data-family-action="toggle-permission" data-member-id="${member.uid}" data-permission="canViewTransactions" ${permissions.canViewTransactions ? 'checked' : ''} />
            <span>Transactions</span>
          </label>
          <label class="family-permission-toggle">
            <input type="checkbox" data-family-action="toggle-permission" data-member-id="${member.uid}" data-permission="canViewGoals" ${permissions.canViewGoals ? 'checked' : ''} />
            <span>Goals</span>
          </label>
          <label class="family-permission-toggle">
            <input type="checkbox" data-family-action="toggle-permission" data-member-id="${member.uid}" data-permission="canViewSplitRatios" ${permissions.canViewSplitRatios ? 'checked' : ''} />
            <span>Split Ratios</span>
          </label>
        </div>
      </li>
    `;
  }).join('');
}

function renderChildFamilyPanel() {
  const familyName = currentFamily?.name || 'Not linked';
  const parentMember = currentFamily;

  elements.familySectionCopy.textContent = 'This child account is linked to a family portal and can be monitored by a parent.';
  elements.childFamilyName.textContent = familyName;
  elements.childFamilyStatus.textContent = currentFamily ? 'Connected' : 'Not connected';
  elements.childFamilyCopy.textContent = parentMember
    ? `Connected to ${parentMember.displayName || parentMember.email}.`
    : 'Connected to a family portal.';
}

function renderSoloFamilyPanel() {
  elements.familySectionCopy.textContent = 'Individual accounts are private by default and are not linked to a parent portal.';
}

function renderFamilySection() {
  const role = currentUserProfile?.role || 'solo';

  setRoleBadge(role);
  setFamilySectionMode(role);
  renderRoleSwitchControl(role);

  // One role-specific panel is active at a time to keep permissions and copy unambiguous.
  if (role === 'parent') {
    renderParentFamilyPanel();
    return;
  }

  if (role === 'child') {
    renderChildFamilyPanel();
    return;
  }

  renderSoloFamilyPanel();
}

async function createUniqueInviteCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const nextCode = generateInviteCode(6);
    const existingFamily = await findFamilyByInviteCode(nextCode);

    if (!existingFamily) {
      return nextCode;
    }
  }

  throw new Error('Could not generate a unique invite code right now.');
}

async function loadFamilySettings(profile) {
  currentFamily = null;
  currentFamilyMembers = [];

  const role = profile?.role || 'solo';

  if (role === 'parent') {
    const parentUid = profile?.primaryFamilyId || currentUser?.uid;

    if (!parentUid) {
      renderFamilySection();
      return;
    }

    try {
      currentFamily = await getFamilyById(parentUid);
      currentFamilyMembers = await listFamilyMembers(parentUid);

      if (!currentFamilyMembers.some((member) => member.uid === parentUid && member.role === 'parent')) {
        await setDoc(doc(db, 'users', parentUid, 'familyMembers', parentUid), {
          uid: parentUid,
          role: 'parent',
          status: 'active',
          displayName: buildDisplayName(profile.firstName, profile.lastName) || profile.username || profile.email || 'Parent',
          email: profile.email || '',
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
        currentFamilyMembers = await listFamilyMembers(parentUid);
      }
    } catch (error) {
      console.error('Failed to load parent family settings:', error);
      setFamilyMessage('Could not load parent family settings right now.', 'error');
    }

    renderFamilySection();
    return;
  }

  if (!profile?.primaryFamilyId) {
    renderFamilySection();
    return;
  }

  try {
    currentFamily = await getFamilyById(profile.primaryFamilyId);
    currentFamilyMembers = currentFamily ? await listFamilyMembers(profile.primaryFamilyId) : [];
  } catch (error) {
    console.error('Failed to load family settings:', error);
    setFamilyMessage('Could not load family settings right now.', 'error');
  }

  renderFamilySection();
}

async function handleCopyInviteCode() {
  if (!currentFamily?.inviteCode) {
    setFamilyMessage('No invite code is available yet.', 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(currentFamily.inviteCode);
    setFamilyMessage('Invite code copied.', 'success');
  } catch {
    setFamilyMessage(`Invite code: ${currentFamily.inviteCode}`, 'success');
  }
}

async function handleRegenerateInviteCode() {
  if (!currentUser?.uid || currentUserProfile?.role !== 'parent') {
    return;
  }

  try {
    const nextCode = await createUniqueInviteCode();
    await updateDoc(doc(db, 'users', currentUser.uid), {
      inviteCode: nextCode,
      inviteStatus: 'active',
      updatedAt: serverTimestamp()
    });

    currentFamily = {
      ...(currentFamily || {}),
      id: currentUser.uid,
      inviteCode: nextCode
    };
    renderFamilySection();
    setFamilyMessage('Invite code regenerated.', 'success');
  } catch (error) {
    console.error('Failed to regenerate invite code:', error);
    setFamilyMessage('Could not regenerate the invite code.', 'error');
  }
}

async function handleJoinParentByCode() {
  if (!currentUser?.uid || currentUserProfile?.role !== 'parent') {
    return;
  }

  const enteredCode = elements.joinParentCodeInput?.value || '';
  const linkedParent = await findFamilyByInviteCode(enteredCode);

  if (!linkedParent || linkedParent.role !== 'parent') {
    setFamilyMessage('That parent invite code is invalid.', 'error');
    return;
  }

  if (linkedParent.id === currentUser.uid) {
    setFamilyMessage('That invite code belongs to your account.', 'error');
    return;
  }

  const myDisplayName = buildDisplayName(currentUserProfile?.firstName, currentUserProfile?.lastName) || currentUserProfile?.username || currentUserProfile?.email || 'Parent';
  const theirDisplayName = buildDisplayName(linkedParent.firstName, linkedParent.lastName) || linkedParent.username || linkedParent.email || 'Parent';

  try {
    await Promise.all([
      setDoc(doc(db, 'users', currentUser.uid, 'familyMembers', linkedParent.id), {
        uid: linkedParent.id,
        role: 'parent',
        status: 'active',
        displayName: theirDisplayName,
        email: linkedParent.email || '',
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true }),
      setDoc(doc(db, 'users', linkedParent.id, 'familyMembers', currentUser.uid), {
        uid: currentUser.uid,
        role: 'parent',
        status: 'active',
        displayName: myDisplayName,
        email: currentUserProfile?.email || currentUser.email || '',
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true })
    ]);

    elements.joinParentCodeInput.value = '';
    await loadFamilySettings(currentUserProfile);
    setFamilyMessage('Parent linked successfully.', 'success');
  } catch (error) {
    console.error('Failed to link parent account:', error);
    setFamilyMessage('Could not link that parent account right now.', 'error');
  }
}

async function handleFamilyChildrenInteraction(event) {
  const actionTarget = event.target.closest('[data-family-action]');

  if (!actionTarget || !currentUser?.uid) {
    return;
  }

  const memberId = actionTarget.dataset.memberId;
  const action = actionTarget.dataset.familyAction;

  if (!memberId) {
    return;
  }

  try {
    if (action === 'toggle-permission' && actionTarget.matches('input[type="checkbox"]')) {
      const permission = actionTarget.dataset.permission;
      await updateDoc(doc(db, 'users', currentUser.uid, 'familyMembers', memberId), {
        [`permissions.${permission}`]: actionTarget.checked,
        updatedAt: serverTimestamp()
      });

      const member = currentFamilyMembers.find((entry) => entry.uid === memberId);
      if (member) {
        member.permissions = {
          ...(member.permissions || {}),
          [permission]: actionTarget.checked
        };
      }

      setFamilyMessage('Child portal permissions updated.', 'success');
      return;
    }

    if (action === 'remove-child') {
      if (!window.confirm('Remove this child from the family portal?')) {
        return;
      }

      await deleteDoc(doc(db, 'users', currentUser.uid, 'familyMembers', memberId));
      await updateDoc(doc(db, 'users', memberId), {
        role: 'solo',
        primaryFamilyId: null,
        updatedAt: serverTimestamp()
      });

      currentFamilyMembers = currentFamilyMembers.filter((member) => member.uid !== memberId);
      renderFamilySection();
      setFamilyMessage('Child removed from the family portal.', 'success');
    }
  } catch (error) {
    console.error('Failed to update family membership:', error);
    setFamilyMessage('Could not update family settings.', 'error');
  }
}

async function switchRoleTo(targetRole) {
  if (!currentUser?.uid || !currentUserProfile) {
    return false;
  }

  const currentRole = currentUserProfile.role || 'solo';

  if (targetRole === currentRole) {
    return false;
  }

  setFormDisabled(true);

  try {
    const updatePayload = {
      role: targetRole,
      updatedAt: serverTimestamp()
    };

    const oldPrimaryFamilyId = currentUserProfile.primaryFamilyId || null;

    if (currentRole === 'child' && oldPrimaryFamilyId) {
      await deleteDoc(doc(db, 'users', oldPrimaryFamilyId, 'familyMembers', currentUser.uid));
    }

    if (targetRole === 'solo') {
      updatePayload.primaryFamilyId = null;
    }

    if (targetRole === 'parent') {
      const existingInviteCode = String(currentUserProfile.inviteCode || '').trim();
      const nextInviteCode = existingInviteCode || await createUniqueInviteCode();

      updatePayload.primaryFamilyId = currentUser.uid;
      updatePayload.inviteCode = nextInviteCode;
      updatePayload.inviteStatus = 'active';

      await setDoc(doc(db, 'users', currentUser.uid, 'familyMembers', currentUser.uid), {
        uid: currentUser.uid,
        role: 'parent',
        status: 'active',
        displayName: buildDisplayName(currentUserProfile.firstName, currentUserProfile.lastName) || currentUserProfile.username || currentUserProfile.email || 'Parent',
        email: currentUserProfile.email || currentUser.email || '',
        permissions: getDefaultMemberPermissions('parent'),
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    if (targetRole === 'child') {
      const rawCode = window.prompt('Enter the parent invite code to connect this account as a child:');
      const inviteCode = normalizeInviteCode(rawCode || '');

      if (!inviteCode) {
        setFamilyMessage('A valid parent invite code is required to switch to Child.', 'error');
        return false;
      }

      const linkedParent = await findFamilyByInviteCode(inviteCode);

      if (!linkedParent || linkedParent.role !== 'parent') {
        setFamilyMessage('That parent invite code is invalid.', 'error');
        return false;
      }

      if (linkedParent.id === currentUser.uid) {
        setFamilyMessage('You cannot use your own invite code for Child mode.', 'error');
        return false;
      }

      updatePayload.primaryFamilyId = linkedParent.id;

      await setDoc(doc(db, 'users', linkedParent.id, 'familyMembers', currentUser.uid), {
        uid: currentUser.uid,
        role: 'child',
        status: 'active',
        displayName: buildDisplayName(currentUserProfile.firstName, currentUserProfile.lastName) || currentUserProfile.username || currentUserProfile.email || 'Child Account',
        email: currentUserProfile.email || currentUser.email || '',
        permissions: getDefaultMemberPermissions('child'),
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    await updateDoc(doc(db, 'users', currentUser.uid), updatePayload);

    currentUserProfile = {
      ...currentUserProfile,
      ...updatePayload,
      role: targetRole,
      primaryFamilyId: updatePayload.primaryFamilyId ?? null
    };

    await loadFamilySettings(currentUserProfile);
    setFamilyMessage(`Account role updated to ${getRoleLabel(targetRole)}.`, 'success');
    return true;
  } catch (error) {
    console.error('Failed to switch account role:', error);
    setFamilyMessage('Could not update account role right now.', 'error');
    return false;
  } finally {
    setFormDisabled(false);
  }
}

function setProfilePhotoModalOpen(isOpen) {
  if (!elements.profilePhotoModal) {
    return;
  }

  if (isOpen) {
    const sectionRect = elements.profileSection?.getBoundingClientRect();
    if (sectionRect) {
      const modalWidth = Math.min(400, Math.max(280, window.innerWidth * 0.95));
      const targetLeft = Math.min(
        Math.max(8, sectionRect.left + 10),
        Math.max(8, window.innerWidth - modalWidth - 12)
      );
      const targetTop = Math.max(8, sectionRect.top + 10);

      elements.profilePhotoModal.style.setProperty('--profile-photo-modal-left', `${targetLeft}px`);
      elements.profilePhotoModal.style.setProperty('--profile-photo-modal-top', `${targetTop}px`);
    }
  }

  elements.profilePhotoModal.hidden = !isOpen;

  if (isOpen) {
    if (photoSourceImage) {
      elements.profilePhotoCropper.hidden = false;
      elements.profilePhotoControls.hidden = false;
      setPhotoModalCopy('Adjust your image in the crop area below.');
      drawCropPreview();
    } else {
      elements.profilePhotoCropper.hidden = true;
      elements.profilePhotoControls.hidden = true;
      setPhotoModalCopy('');
    }
  }
}

async function persistPendingProfilePhotoSelection() {
  if (!currentUser?.uid || (!pendingProfilePhotoDataUrl && !pendingProfileAvatarName)) {
    return;
  }

  try {
    const nextPhotoAvatarName = pendingProfileAvatarName
      ? String(pendingProfileAvatarName || '').trim()
      : '';
    const nextPhotoURL = nextPhotoAvatarName
      ? ''
      : String(pendingProfilePhotoDataUrl || '').trim();

    if (nextPhotoURL) {
      saveLocalProfilePhoto(currentUser.uid, nextPhotoURL);
    } else {
      saveLocalProfilePhoto(currentUser.uid, '');
    }

    await updateDoc(doc(db, 'users', currentUser.uid), {
      photoURL: nextPhotoURL,
      photoAvatarName: nextPhotoAvatarName,
      updatedAt: serverTimestamp()
    });

    currentUserProfile = {
      ...(currentUserProfile || {}),
      photoURL: nextPhotoURL,
      photoAvatarName: nextPhotoAvatarName
    };

    setProfilePhotoPreview(nextPhotoURL, nextPhotoAvatarName);
    broadcastProfileUpdate(nextPhotoURL || '', nextPhotoURL || '', currentUser.uid);

    pendingProfilePhotoDataUrl = '';
    pendingProfileAvatarName = '';
    pendingProfilePhotoObjectUrl = '';
    photoSourceImage = null;
    hasUnappliedCrop = false;
    elements.profilePhotoInput.value = '';
    elements.profilePhotoCropper.hidden = true;
    elements.profilePhotoControls.hidden = true;

    setAccountMessage('Profile photo saved.', 'success');
  } catch (error) {
    console.error('Failed to save profile photo selection:', error);
    setAccountMessage('Could not save profile photo right now.', 'error');
  }
}

async function closeProfilePhotoModalWithSave() {
  await persistPendingProfilePhotoSelection();
  setProfilePhotoModalOpen(false);
}

function resetCropState() {
  cropState.zoom = 1;
  cropState.offsetX = 0;
  cropState.offsetY = 0;

  elements.profilePhotoZoomInput.value = '1';
  elements.profilePhotoOffsetXInput.value = '0';
  elements.profilePhotoOffsetYInput.value = '0';
}

function handlePresetAvatarSelection(avatarName) {
  const selectedAvatarName = String(avatarName || '').trim();
  const selectedAvatarSource = getPresetAvatarSource(selectedAvatarName);

  if (!selectedAvatarName || !selectedAvatarSource) {
    return;
  }

  pendingProfileAvatarName = selectedAvatarName;
  pendingProfilePhotoDataUrl = '';
  hasUnappliedCrop = false;
  photoSourceImage = null;

  elements.profilePhotoInput.value = '';
  elements.profilePhotoCropper.hidden = true;
  elements.profilePhotoControls.hidden = true;

  setProfilePhotoPreview('', selectedAvatarName);
  setPhotoModalCopy('');
  setAccountMessage('');
}

function drawCropPreview() {
  if (!photoSourceImage || !elements.profilePhotoCanvas) {
    return;
  }

  const canvas = elements.profilePhotoCanvas;
  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const baseScale = Math.max(canvasWidth / photoSourceImage.width, canvasHeight / photoSourceImage.height);
  const scaledWidth = photoSourceImage.width * baseScale * cropState.zoom;
  const scaledHeight = photoSourceImage.height * baseScale * cropState.zoom;
  const drawX = (canvasWidth - scaledWidth) / 2 + cropState.offsetX;
  const drawY = (canvasHeight - scaledHeight) / 2 + cropState.offsetY;

  context.drawImage(photoSourceImage, drawX, drawY, scaledWidth, scaledHeight);
}

function loadImageForCropping(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load the selected image.'));
    };

    image.src = objectUrl;
  });
}

async function handleProfilePhotoInputChange() {
  const file = elements.profilePhotoInput.files?.[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith('image/')) {
    setAccountMessage('Please select a valid image file.', 'error');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    setAccountMessage('Please choose an image under 5 MB.', 'error');
    return;
  }

  try {
    photoSourceImage = await loadImageForCropping(file);
    pendingProfileAvatarName = '';
    setActiveAvatarOption('');
    resetCropState();
    drawCropPreview();
    elements.profilePhotoCropper.hidden = false;
    elements.profilePhotoControls.hidden = false;
    hasUnappliedCrop = true;
    setPhotoModalCopy('Image loaded. Adjust the crop, then choose Use Cropped Photo.');
    setAccountMessage('Adjust the crop, then use cropped photo.', '');
  } catch (error) {
    console.error('Failed to load profile image:', error);
    setAccountMessage('Could not load that image. Try a different file.', 'error');
  }
}

function updateCropFromControls() {
  cropState.zoom = Number(elements.profilePhotoZoomInput.value);
  cropState.offsetX = Number(elements.profilePhotoOffsetXInput.value);
  cropState.offsetY = Number(elements.profilePhotoOffsetYInput.value);
  hasUnappliedCrop = true;
  drawCropPreview();
}

function exportCompressedProfilePhoto(canvas) {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = PROFILE_PHOTO_SIZE;
  exportCanvas.height = PROFILE_PHOTO_SIZE;

  const exportContext = exportCanvas.getContext('2d');

  if (!exportContext) {
    throw new Error('Could not prepare image for save.');
  }

  exportContext.fillStyle = '#ffffff';
  exportContext.fillRect(0, 0, PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE);
  exportContext.drawImage(canvas, 0, 0, PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE);

  return exportCanvas.toDataURL('image/jpeg', PROFILE_PHOTO_JPEG_QUALITY);
}

async function handleApplyCroppedPhoto() {
  if (!photoSourceImage || !elements.profilePhotoCanvas) {
    setAccountMessage('Upload an image first.', 'error');
    return;
  }

  try {
    const compressedDataUrl = exportCompressedProfilePhoto(elements.profilePhotoCanvas);
    pendingProfilePhotoDataUrl = compressedDataUrl;
    pendingProfileAvatarName = '';
    hasUnappliedCrop = false;

    if (pendingProfilePhotoObjectUrl) {
      URL.revokeObjectURL(pendingProfilePhotoObjectUrl);
    }

    pendingProfilePhotoObjectUrl = compressedDataUrl;
    setProfilePhotoPreview(pendingProfilePhotoObjectUrl);
    setAccountMessage('Cropped photo ready.', 'success');
    setPhotoModalCopy('Cropped photo selected. Click outside the popup to save.');
    setProfilePhotoModalOpen(false);
  } catch (error) {
    console.error('Failed to crop profile image:', error);
    setAccountMessage('Could not crop this image. Please try again.', 'error');
  }
}

function handleResetCrop() {
  if (!photoSourceImage) {
    return;
  }

  resetCropState();
  drawCropPreview();
  hasUnappliedCrop = true;
  setPhotoModalCopy('Crop reset. Adjust and use cropped photo when ready.');
  setAccountMessage('Crop has been reset.', '');
}

function broadcastProfileUpdate(photoURL, localPhotoDataUrl = '', userId = '') {
  const payload = JSON.stringify({
    photoURL,
    localPhotoDataUrl,
    photoAvatarName: String(currentUserProfile?.photoAvatarName || '').trim(),
    userId,
    at: Date.now()
  });

  localStorage.setItem('mf_profile_updated', payload);

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'mf-profile-updated',
      photoURL,
      localPhotoDataUrl,
      photoAvatarName: String(currentUserProfile?.photoAvatarName || '').trim(),
      userId
    }, window.location.origin);
  }
}

function setProfilePhotoEditingDisabled(disabled) {
  elements.openPhotoModalButton.disabled = disabled;
  elements.profilePhotoInput.disabled = disabled;
  elements.profilePhotoZoomInput.disabled = disabled;
  elements.profilePhotoOffsetXInput.disabled = disabled;
  elements.profilePhotoOffsetYInput.disabled = disabled;
  elements.profilePhotoApplyButton.disabled = disabled;
  elements.profilePhotoResetButton.disabled = disabled;
}

function setAccountMessage(text = '', type = '') {
  const el = elements.accountMessage;
  if (!el) return;
  if (accountMessageTimeoutId) {
    clearTimeout(accountMessageTimeoutId);
    accountMessageTimeoutId = null;
  }
  el.textContent = text;
  el.className = 'inline-save-message' + (type ? ` ${type}` : '');
  if (text && type === 'success') {
    accountMessageTimeoutId = setTimeout(() => {
      el.textContent = '';
      el.className = 'inline-save-message';
      accountMessageTimeoutId = null;
    }, 3000);
  }
}

function setPageMessage(text = '', type = '') {
  elements.pageMessage.textContent = text;
  elements.pageMessage.className = 'page-message';
  if (type) {
    elements.pageMessage.classList.add(type);
  }
}

function setDeleteAccountMessage(text = '', type = '') {
  if (!elements.deleteAccountMessage) {
    return;
  }

  elements.deleteAccountMessage.textContent = text;
  elements.deleteAccountMessage.className = 'page-message family-inline-message';

  if (type) {
    elements.deleteAccountMessage.classList.add(type);
  }
}

function positionDeleteAccountModal() {
  if (!elements.deleteAccountModal || !elements.openDeleteAccountModalButton) {
    return;
  }

  const modalContent = elements.deleteAccountModal.querySelector('.modal-content');

  if (!modalContent) {
    return;
  }

  const buttonRect = elements.openDeleteAccountModalButton.getBoundingClientRect();
  const modalRect = modalContent.getBoundingClientRect();
  const modalWidth = modalRect.width || 380;
  const modalHeight = modalRect.height || 320;
  const margin = 10;
  const gap = 8;

  let left = buttonRect.right - modalWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - modalWidth - margin));

  let top = buttonRect.bottom + gap;
  if (top + modalHeight > window.innerHeight - margin) {
    top = buttonRect.top - modalHeight - gap;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - modalHeight - margin));

  elements.deleteAccountModal.style.setProperty('--delete-account-modal-left', `${Math.round(left)}px`);
  elements.deleteAccountModal.style.setProperty('--delete-account-modal-top', `${Math.round(top)}px`);
}

function setDeleteAccountModalOpen(show) {
  if (!elements.deleteAccountModal) {
    return;
  }

  elements.deleteAccountModal.hidden = !show;

  if (show) {
    setDeleteAccountMessage('');
    positionDeleteAccountModal();
    if (elements.deleteAccountPasswordInput) {
      elements.deleteAccountPasswordInput.value = '';
      elements.deleteAccountPasswordInput.focus();
    }
  }
}

async function deleteAllDocsInUserSubcollection(userId, subcollectionName) {
  const subcollectionRef = collection(db, 'users', userId, subcollectionName);
  const snapshot = await getDocs(subcollectionRef);

  if (snapshot.empty) {
    return;
  }

  const batch = writeBatch(db);
  snapshot.docs.forEach((entry) => batch.delete(entry.ref));
  await batch.commit();
}

async function cleanupFamilyLinksBeforeDelete(user, profile) {
  const role = profile?.role || 'solo';
  const primaryFamilyId = profile?.primaryFamilyId || null;

  if (role === 'child' && primaryFamilyId) {
    await deleteDoc(doc(db, 'users', primaryFamilyId, 'familyMembers', user.uid));
    return;
  }

  if (role === 'parent') {
    const members = await listFamilyMembers(user.uid);
    const childMembers = members.filter((member) => member.role === 'child' && member.status === 'active');
    const parentMembers = members.filter((member) => member.role === 'parent' && member.uid !== user.uid);

    const childUpdateWrites = childMembers.map((member) => updateDoc(doc(db, 'users', member.uid), {
      role: 'solo',
      primaryFamilyId: null,
      updatedAt: serverTimestamp()
    }));

    const parentRemovalWrites = parentMembers.map((member) => deleteDoc(doc(db, 'users', member.uid, 'familyMembers', user.uid)));

    await Promise.all([...childUpdateWrites, ...parentRemovalWrites]);
  }
}

async function deleteUserOwnedData(userId) {
  await Promise.all([
    deleteAllDocsInUserSubcollection(userId, 'transactions'),
    deleteAllDocsInUserSubcollection(userId, 'savingsGoals'),
    deleteAllDocsInUserSubcollection(userId, 'familyMembers')
  ]);

  await Promise.all([
    deleteDoc(doc(db, 'users', userId, 'splitRatios', 'current')),
    deleteDoc(doc(db, 'users', userId, 'splitRatios', 'percentageCategories')),
    deleteDoc(doc(db, 'users', userId, 'splitRatios', 'billCategories')),
    deleteDoc(doc(db, 'users', userId))
  ]);
}

async function handleDeleteAccount() {
  if (!currentUser || !currentUser.email) {
    setDeleteAccountMessage('You must be signed in to delete your account.', 'error');
    return;
  }

  const password = String(elements.deleteAccountPasswordInput?.value || '');

  if (!password) {
    setDeleteAccountMessage('Please enter your password to continue.', 'error');
    return;
  }

  elements.confirmDeleteAccountButton.disabled = true;
  elements.deleteAccountPasswordInput.disabled = true;
  setFormDisabled(true);
  setDeleteAccountMessage('Verifying password and deleting account…');

  try {
    const credential = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, credential);

    await cleanupFamilyLinksBeforeDelete(currentUser, currentUserProfile);
    await deleteUserOwnedData(currentUser.uid);

    saveLocalProfilePhoto(currentUser.uid, '');
    localStorage.removeItem('goals');

    await deleteUser(currentUser);
    window.location.replace('login.html?accountDeleted=1');
  } catch (error) {
    console.error('Failed to delete account:', error);

    if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
      setDeleteAccountMessage('Password is incorrect. Please try again.', 'error');
    } else if (error.code === 'auth/too-many-requests') {
      setDeleteAccountMessage('Too many attempts. Please wait a moment and try again.', 'error');
    } else {
      setDeleteAccountMessage('Could not delete your account right now. Please try again.', 'error');
    }
  } finally {
    elements.confirmDeleteAccountButton.disabled = false;
    elements.deleteAccountPasswordInput.disabled = false;
    setFormDisabled(false);
  }
}

function setFormDisabled(disabled) {
  elements.saveButton.disabled = disabled;
  elements.firstNameInput.disabled = disabled;
  elements.lastNameInput.disabled = disabled;
  elements.usernameInput.disabled = disabled;
  elements.emailInput.disabled = disabled;
  elements.copyInviteButton.disabled = disabled;
  elements.regenerateInviteButton.disabled = disabled;
  elements.joinParentButton.disabled = disabled;
  elements.joinParentCodeInput.disabled = disabled;
  elements.roleSwitchToggleButton.disabled = disabled;
  elements.roleSwitchSelect.disabled = disabled;
  elements.roleSwitchVerifyInput.disabled = disabled;
  elements.roleSwitchCancelButton.disabled = disabled;
  elements.roleSwitchApplyButton.disabled = disabled;
  if (elements.openDeleteAccountModalButton) {
    elements.openDeleteAccountModalButton.disabled = disabled;
  }
  if (elements.confirmDeleteAccountButton) {
    elements.confirmDeleteAccountButton.disabled = disabled;
  }
  if (elements.deleteAccountPasswordInput) {
    elements.deleteAccountPasswordInput.disabled = disabled;
  }
  setProfilePhotoEditingDisabled(disabled);
}

async function loadAccountData(user) {
  setFormDisabled(true);
  setPageMessage('Loading account information…');

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const data = userDoc.exists() ? userDoc.data() : {};
    currentUserProfile = {
      uid: user.uid,
      ...data,
      role: data.role || 'solo',
      primaryFamilyId: data.primaryFamilyId || (data.role === 'parent' ? user.uid : null)
    };

    elements.firstNameInput.value = data.firstName || (user.displayName || '').split(' ')[0] || '';
    elements.lastNameInput.value = data.lastName || (user.displayName || '').split(' ').slice(1).join(' ') || '';
    elements.usernameInput.value = data.username || '';
    elements.emailInput.value = user.email || '';
    const localPhotoDataUrl = getLocalProfilePhoto(user.uid);
    setProfilePhotoPreview(
      localPhotoDataUrl || data.photoURL || user.photoURL || '',
      String(data.photoAvatarName || '').trim()
    );
    await loadFamilySettings(currentUserProfile);

    setPageMessage('');
  } catch (error) {
    console.error('Failed to load account data:', error);
    setPageMessage('Could not load account information. Please refresh the page.', 'error');
  } finally {
    setFormDisabled(false);
  }
}

async function handleSave(event) {
  event.preventDefault();

  if (!currentUser) {
    setPageMessage('You must be signed in to save changes.', 'error');
    return;
  }

  const firstName = elements.firstNameInput.value.trim();
  const lastName = elements.lastNameInput.value.trim();
  const username = elements.usernameInput.value.trim();
  const newEmail = elements.emailInput.value.trim();

  if (hasUnappliedCrop) {
    setAccountMessage('Apply your photo crop before saving.', 'error');
    return;
  }

  if (!firstName) {
    setPageMessage('First name is required.', 'error');
    return;
  }

  if (!username) {
    setPageMessage('Username is required.', 'error');
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    setPageMessage('Username must be 3–30 characters and use only letters, numbers, or underscores.', 'error');
    return;
  }

  if (!newEmail) {
    setPageMessage('Email is required.', 'error');
    return;
  }

  setFormDisabled(true);
  setPageMessage('Saving…');

  try {
    const displayName = `${firstName} ${lastName}`.trim();
    const writes = [];
    const profileUpdatePayload = {};
    let nextPhotoURL = currentUserProfile?.photoURL || currentUser.photoURL || '';
    let nextPhotoAvatarName = String(currentUserProfile?.photoAvatarName || '').trim();
    let localPhotoDataUrl = getLocalProfilePhoto(currentUser.uid);

    if (displayName && currentUser.displayName !== displayName) {
      profileUpdatePayload.displayName = displayName;
    }

    if (pendingProfilePhotoDataUrl) {
      saveLocalProfilePhoto(currentUser.uid, pendingProfilePhotoDataUrl);
      localPhotoDataUrl = pendingProfilePhotoDataUrl;
      nextPhotoURL = pendingProfilePhotoDataUrl;
      nextPhotoAvatarName = '';
    }

    if (pendingProfileAvatarName) {
      saveLocalProfilePhoto(currentUser.uid, '');
      localPhotoDataUrl = '';
      nextPhotoURL = '';
      nextPhotoAvatarName = pendingProfileAvatarName;
    }

    if (Object.keys(profileUpdatePayload).length > 0) {
      writes.push(updateProfile(currentUser, profileUpdatePayload));
    }

    // Update email in Firebase Auth if it changed
    if (currentUser.email !== newEmail) {
      writes.push(updateEmail(currentUser, newEmail));
    }

    await Promise.all(writes);

    // Update Firestore profile document
    await updateDoc(doc(db, 'users', currentUser.uid), {
      firstName,
      lastName,
      username,
      email: newEmail,
      photoURL: nextPhotoURL || '',
      photoAvatarName: nextPhotoAvatarName || '',
      updatedAt: serverTimestamp()
    });

    currentUserProfile = {
      ...(currentUserProfile || {}),
      firstName,
      lastName,
      username,
      email: newEmail,
      photoURL: nextPhotoURL || '',
      photoAvatarName: nextPhotoAvatarName || ''
    };

    if (pendingProfilePhotoDataUrl || pendingProfileAvatarName) {
      pendingProfilePhotoDataUrl = '';
      pendingProfileAvatarName = '';
      pendingProfilePhotoObjectUrl = '';
      photoSourceImage = null;
      elements.profilePhotoInput.value = '';
      elements.profilePhotoCropper.hidden = true;
      elements.profilePhotoControls.hidden = true;
      broadcastProfileUpdate(nextPhotoURL || '', localPhotoDataUrl || '', currentUser.uid);
    }

    setPageMessage('');
    setAccountMessage('Account updated successfully.', 'success');
  } catch (error) {
    console.error('Failed to save account changes:', error);

    if (error.code === 'auth/requires-recent-login') {
      setAccountMessage('Changing your email requires a recent sign-in. Please log out, sign back in, and try again.', 'error');
    } else if (error.code === 'auth/email-already-in-use') {
      setAccountMessage('That email address is already associated with another account.', 'error');
    } else if (error.code === 'auth/invalid-email') {
      setAccountMessage('Please enter a valid email address.', 'error');
    } else {
      setAccountMessage('Could not save changes. Please try again.', 'error');
    }
  } finally {
    setFormDisabled(false);
  }
}

function setupProfilePhotoListeners() {
  elements.openPhotoModalButton.addEventListener('click', () => {
    setProfilePhotoModalOpen(true);
  });

  elements.profilePhotoModal.addEventListener('click', async (event) => {
    const clickedBackdrop = event.target.classList?.contains('modal-backdrop');

    if (clickedBackdrop) {
      await closeProfilePhotoModalWithSave();
    }
  });

  document.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape' && !elements.profilePhotoModal.hidden) {
      await closeProfilePhotoModalWithSave();
    }
  });

  window.addEventListener('resize', () => {
    if (!elements.profilePhotoModal.hidden) {
      setProfilePhotoModalOpen(true);
    }
  });

  elements.profilePhotoInput.addEventListener('change', handleProfilePhotoInputChange);

  if (elements.profileAvatarPicker) {
    elements.profileAvatarPicker.addEventListener('click', (event) => {
      const avatarButton = event.target.closest('.profile-avatar-option[data-avatar-name]');

      if (!avatarButton) {
        return;
      }

      handlePresetAvatarSelection(avatarButton.dataset.avatarName);
    });
  }

  elements.profilePhotoZoomInput.addEventListener('input', updateCropFromControls);
  elements.profilePhotoOffsetXInput.addEventListener('input', updateCropFromControls);
  elements.profilePhotoOffsetYInput.addEventListener('input', updateCropFromControls);
  elements.profilePhotoApplyButton.addEventListener('click', handleApplyCroppedPhoto);
  elements.profilePhotoResetButton.addEventListener('click', handleResetCrop);
}

function setupFamilyListeners() {
  setRoleSwitchPanelOpen(false);

  elements.copyInviteButton.addEventListener('click', handleCopyInviteCode);
  elements.regenerateInviteButton.addEventListener('click', handleRegenerateInviteCode);
  elements.joinParentButton.addEventListener('click', handleJoinParentByCode);
  elements.roleSwitchToggleButton.addEventListener('click', () => {
    setRoleSwitchPanelOpen(elements.roleSwitchPanel.hidden);
  });
  elements.roleSwitchCancelButton.addEventListener('click', () => {
    setRoleSwitchPanelOpen(false);
  });
  elements.roleSwitchApplyButton.addEventListener('click', async () => {
    const verifyText = String(elements.roleSwitchVerifyInput.value || '').trim().toUpperCase();

    if (verifyText !== 'SWITCH') {
      setFamilyMessage('Please type SWITCH to verify role changes.', 'error');
      return;
    }

    const targetRole = elements.roleSwitchSelect.value === 'child' ? 'child' : 'parent';
    const switched = await switchRoleTo(targetRole);
    if (switched) {
      setRoleSwitchPanelOpen(false);
    }
  });

  document.addEventListener('click', (event) => {
    if (!elements.roleSwitchRow || elements.roleSwitchRow.hidden || elements.roleSwitchPanel.hidden) {
      return;
    }

    if (!elements.roleSwitchRow.contains(event.target)) {
      setRoleSwitchPanelOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.roleSwitchPanel && !elements.roleSwitchPanel.hidden) {
      setRoleSwitchPanelOpen(false);
    }
  });

  window.addEventListener('blur', () => {
    if (elements.roleSwitchPanel && !elements.roleSwitchPanel.hidden) {
      setRoleSwitchPanelOpen(false);
    }
  });

  elements.familyChildrenList.addEventListener('click', handleFamilyChildrenInteraction);
  elements.familyChildrenList.addEventListener('change', handleFamilyChildrenInteraction);
}

function setupDeleteAccountListeners() {
  if (!elements.openDeleteAccountModalButton || !elements.deleteAccountModal || !elements.confirmDeleteAccountButton) {
    return;
  }

  elements.openDeleteAccountModalButton.addEventListener('click', () => {
    setDeleteAccountModalOpen(true);
  });

  elements.deleteAccountModal.addEventListener('click', (event) => {
    if (event.target.closest('[data-delete-close]')) {
      setDeleteAccountModalOpen(false);
    }
  });

  elements.deleteAccountPasswordInput?.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      await handleDeleteAccount();
    }
  });

  elements.confirmDeleteAccountButton.addEventListener('click', handleDeleteAccount);

  document.addEventListener('click', (event) => {
    if (elements.deleteAccountModal.hidden) {
      return;
    }

    const modalContent = elements.deleteAccountModal.querySelector('.modal-content');
    const clickedInsideModal = modalContent?.contains(event.target);
    const clickedOpenButton = elements.openDeleteAccountModalButton.contains(event.target);

    if (!clickedInsideModal && !clickedOpenButton) {
      setDeleteAccountModalOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.deleteAccountModal && !elements.deleteAccountModal.hidden) {
      setDeleteAccountModalOpen(false);
    }
  });

  window.addEventListener('resize', () => {
    if (elements.deleteAccountModal && !elements.deleteAccountModal.hidden) {
      positionDeleteAccountModal();
    }
  });

  window.addEventListener('scroll', () => {
    if (elements.deleteAccountModal && !elements.deleteAccountModal.hidden) {
      positionDeleteAccountModal();
    }
  }, true);
}

async function handleResetPassword() {
  if (!currentUser?.email) {
    setPageMessage('No email address is associated with this account.', 'error');
    return;
  }

  elements.resetPasswordButton.disabled = true;

  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    setPageMessage(`Password reset email sent to ${currentUser.email}.`, 'success');
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    setPageMessage('Could not send password reset email. Please try again.', 'error');
  } finally {
    elements.resetPasswordButton.disabled = false;
  }
}

function handleAuthStateChanged(user) {
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  currentUser = user;
  loadAccountData(user);
}

elements.form.addEventListener('submit', handleSave);
elements.resetPasswordButton.addEventListener('click', handleResetPassword);
setupProfilePhotoListeners();
setupFamilyListeners();
setupDeleteAccountListeners();

onAuthStateChanged(auth, handleAuthStateChanged);
