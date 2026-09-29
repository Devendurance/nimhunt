import { useCallback, useEffect, useRef, useState } from 'react'
import { NimiqIntegrationError } from '../../integrations/nimiq/nimiqErrors'
import {
  createAdventurerProfile,
  createAdventurerSession,
  fetchAdventurerNameAvailability,
  renameAdventurer,
  requestAdventurerRenameChallenge,
  fetchOwnAdventurerProfile,
  requestAdventurerCreationChallenge,
  requestAdventurerSessionChallenge,
  updateAdventurerAvatar,
  AdventurerApiError,
  type AdventurerApiErrorCode,
} from '../../api/adventurer.ts'
import {
  NIMHUNT_ADVENTURER_SESSION_V1,
  NIMHUNT_CREATE_ADVENTURER_V1,
  NIMHUNT_RENAME_ADVENTURER_V1,
  serializeAdventurerSessionPayload,
  serializeRenameAdventurerPayload,
  serializeCreateAdventurerPayload,
  type AdventurerProfile,
} from '../../domain/adventurer.ts'
import {
  inspectClientName,
  mapAdventurerClientError,
  mapNameApiError,
  type AdventurerClientError,
  type AdventurerClientStatus,
  type AdventurerCreationStatus,
  type ClientNameState,
} from './adventurerState.ts'

export type AdventurerSignMessage = (message: string) => Promise<{
  readonly publicKey: string
  readonly signature: string
}>

type UseAdventurerOptions = {
  readonly wallet: string | null
  readonly signMessage: AdventurerSignMessage
}

export function useAdventurer({ wallet, signMessage }: UseAdventurerOptions) {
  const [status, setStatus] = useState<AdventurerClientStatus>(wallet ? 'RESTORING' : 'DISCONNECTED')
  const [profile, setProfile] = useState<AdventurerProfile | null>(null)
  const [profileWallet, setProfileWallet] = useState<string | null>(null)
  const [error, setError] = useState<AdventurerClientError | null>(null)
  const [creationStatus, setCreationStatus] = useState<AdventurerCreationStatus>('IDLE')
  const [creationError, setCreationError] = useState<AdventurerClientError | AdventurerApiErrorCode | null>(null)
  const [renameStatus, setRenameStatus] = useState<'IDLE' | 'SIGNING' | 'RENAMING' | 'SUCCESS' | 'CANCELLED' | 'ERROR'>('IDLE')
  const [renameError, setRenameError] = useState<AdventurerClientError | AdventurerApiErrorCode | null>(null)
  const [nameState, setNameState] = useState<ClientNameState>({ status: 'IDLE', normalizedName: null })
  const restoreWalletRef = useRef<string | null>(null)
  const operationRef = useRef(0)
  const nameRequestRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const restore = useCallback(async (targetWallet: string): Promise<void> => {
    const operation = ++operationRef.current
    setProfileWallet(null)
    setProfile(null)
    setStatus('RESTORING')
    setError(null)
    try {
      const own = await fetchOwnAdventurerProfile()
      if (!isCurrent(mountedRef, operationRef, operation)) return
      setProfileWallet(targetWallet)
      setProfile(own)
      setStatus('READY')
      return
    } catch (restoreError) {
      if (!isCurrent(mountedRef, operationRef, operation)) return
      if (!(restoreError instanceof AdventurerApiError) || restoreError.code !== 'ADVENTURER_SESSION_INVALID') {
        setStatus('ERROR')
        setError(mapAdventurerError(restoreError))
        return
      }
    }

    try {
      const challenge = await requestAdventurerSessionChallenge(targetWallet)
      if (!isCurrent(mountedRef, operationRef, operation)) return
      const payload = serializeAdventurerSessionPayload({
        version: NIMHUNT_ADVENTURER_SESSION_V1,
        type: 'ADVENTURER_SESSION',
        wallet: targetWallet,
        challenge: challenge.challenge,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
      })
      const signed = await signMessage(payload)
      if (!isCurrent(mountedRef, operationRef, operation)) return
      const restored = await createAdventurerSession({ payload, ...signed })
      if (!isCurrent(mountedRef, operationRef, operation)) return
      setProfileWallet(targetWallet)
      setProfile(restored.profile)
      setStatus('READY')
    } catch (restoreError) {
      if (!isCurrent(mountedRef, operationRef, operation)) return
      if (isSignatureCancelled(restoreError)) {
        setStatus('ERROR')
        setError('SIGNATURE_CANCELLED')
        return
      }
      if (restoreError instanceof AdventurerApiError && restoreError.code === 'PROFILE_NOT_FOUND') {
        setProfileWallet(targetWallet)
        setProfile(null)
        setStatus('NEEDS_PROFILE')
        return
      }
      setStatus('ERROR')
      setError(mapAdventurerError(restoreError))
    }
  }, [signMessage])

  useEffect(() => {
    if (!wallet) {
      restoreWalletRef.current = null
      return
    }
    if (restoreWalletRef.current === wallet) return
    restoreWalletRef.current = wallet
    void restore(wallet)
  }, [restore, wallet])

  const retryRestore = useCallback(() => {
    if (!wallet) return
    void restore(wallet)
  }, [restore, wallet])

  const checkName = useCallback(async (name: string): Promise<void> => {
    const inspected = inspectClientName(name)
    const request = ++nameRequestRef.current
    setNameState(inspected)
    if (inspected.status !== 'CHECKING') return
    try {
      const result = await fetchAdventurerNameAvailability(name)
      if (nameRequestRef.current !== request) return
      setNameState({ status: result.available ? 'AVAILABLE' : 'TAKEN', normalizedName: result.normalizedName ?? inspected.normalizedName })
    } catch (requestError) {
      if (nameRequestRef.current !== request) return
      const mapped = requestError instanceof AdventurerApiError ? mapNameApiError(requestError.code) : null
      if (mapped) {
        setNameState({ status: mapped, normalizedName: inspected.normalizedName })
      } else {
        setNameState({ status: 'ERROR', normalizedName: inspected.normalizedName })
      }
    }
  }, [])

  const createProfile = useCallback(async (displayName: string, avatarId: string): Promise<boolean> => {
    if (!wallet || creationStatus === 'SIGNING' || creationStatus === 'CREATING') return false
    const operation = ++operationRef.current
    setCreationError(null)
    setCreationStatus('SIGNING')
    try {
      const challenge = await requestAdventurerCreationChallenge(wallet)
      if (!isCurrent(mountedRef, operationRef, operation)) return false
      const payload = serializeCreateAdventurerPayload({
        version: NIMHUNT_CREATE_ADVENTURER_V1,
        type: 'CREATE_ADVENTURER',
        wallet,
        displayName,
        avatarId,
        challenge: challenge.challenge,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
      })
      const signed = await signMessage(payload)
      if (!isCurrent(mountedRef, operationRef, operation)) return false
      setCreationStatus('CREATING')
      const created = await createAdventurerProfile({ payload, ...signed })
      if (!isCurrent(mountedRef, operationRef, operation)) return false
      setProfileWallet(wallet)
      setProfile(created.profile)
      setStatus('READY')
      setCreationStatus('SUCCESS')
      return true
    } catch (creationFailure) {
      if (!isCurrent(mountedRef, operationRef, operation)) return false
      if (isSignatureCancelled(creationFailure)) {
        setCreationStatus('CANCELLED')
        setCreationError('SIGNATURE_CANCELLED')
        return false
      }
      setCreationStatus('ERROR')
      setCreationError(creationFailure instanceof AdventurerApiError ? creationFailure.code : mapAdventurerError(creationFailure))
      return false
    }
  }, [creationStatus, signMessage, wallet])

  const renameProfile = useCallback(async (newName: string): Promise<boolean> => {
    if (!wallet || status !== 'READY' || profileWallet !== wallet || !profile || renameStatus === 'SIGNING' || renameStatus === 'RENAMING') return false
    const operation = ++operationRef.current
    setRenameError(null)
    setRenameStatus('SIGNING')
    try {
      const challenge = await requestAdventurerRenameChallenge()
      if (!isCurrent(mountedRef, operationRef, operation)) return false
      const payload = serializeRenameAdventurerPayload({
        version: NIMHUNT_RENAME_ADVENTURER_V1,
        type: 'RENAME_ADVENTURER',
        playerId: profile.playerId,
        currentName: profile.displayName,
        newName,
        challenge: challenge.challenge,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
      })
      const signed = await signMessage(payload)
      if (!isCurrent(mountedRef, operationRef, operation)) return false
      setRenameStatus('RENAMING')
      const updated = await renameAdventurer({ payload, ...signed })
      if (!isCurrent(mountedRef, operationRef, operation)) return false
      setProfile(updated)
      setRenameStatus('SUCCESS')
      return true
    } catch (renameFailure) {
      if (!isCurrent(mountedRef, operationRef, operation)) return false
      if (isSignatureCancelled(renameFailure)) {
        setRenameStatus('CANCELLED')
        setRenameError('SIGNATURE_CANCELLED')
        return false
      }
      setRenameStatus('ERROR')
      setRenameError(renameFailure instanceof AdventurerApiError ? renameFailure.code : mapAdventurerError(renameFailure))
      return false
    }
  }, [profile, profileWallet, renameStatus, signMessage, status, wallet])

  const resetRename = useCallback(() => {
    setRenameStatus('IDLE')
    setRenameError(null)
  }, [])

  const updateAvatar = useCallback(async (avatarId: string): Promise<boolean> => {
    if (!wallet || status !== 'READY' || profileWallet !== wallet || !profile) return false
    try {
      const updated = await updateAdventurerAvatar(avatarId)
      setProfile(updated)
      setCreationError(null)
      return true
    } catch (updateError) {
      if (updateError instanceof AdventurerApiError && updateError.code === 'ADVENTURER_SESSION_INVALID') {
        setStatus('ERROR')
        setError('ADVENTURER_SESSION_INVALID')
      }
      setCreationError(updateError instanceof AdventurerApiError ? updateError.code : mapAdventurerError(updateError))
      return false
    }
  }, [profile, profileWallet, status, wallet])

  const resetCreation = useCallback(() => {
    setCreationStatus('IDLE')
    setCreationError(null)
  }, [])

  const effectiveStatus: AdventurerClientStatus = !wallet ? 'DISCONNECTED' : status
  const effectiveProfile = wallet && profileWallet === wallet ? profile : null

  return {
    status: effectiveStatus,
    profile: effectiveProfile,
    error: wallet ? error : null,
    creationStatus,
    creationError,
    renameStatus,
    renameError,
    nameState,
    checkName,
    createProfile,
    resetCreation,
    resetRename,
    retryRestore,
    renameProfile,
    updateAvatar,
    hasProfile: effectiveProfile !== null,
  }
}

function isCurrent(mountedRef: { readonly current: boolean }, operationRef: { readonly current: number }, operation: number): boolean {
  return mountedRef.current && operationRef.current === operation
}

function isSignatureCancelled(error: unknown): boolean {
  return error instanceof NimiqIntegrationError && error.code === 'SIGN_CANCELLED'
}

function mapAdventurerError(error: unknown): AdventurerClientError {
  if (error instanceof AdventurerApiError) return mapAdventurerClientError(error.code)
  return 'ADVENTURER_UNAVAILABLE'
}
