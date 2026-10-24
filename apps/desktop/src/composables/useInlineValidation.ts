import { ref } from 'vue'

/** Keep native constraints, but present their messages in the app's own surface. */
export function useInlineValidation() {
  const errors = ref<Record<string, string>>({})

  const validateField = (field: HTMLInputElement, trimRequired = true) => {
    const valid = field.disabled || field.checkValidity()
    const message = !valid
      ? field.validationMessage
      : field.willValidate && trimRequired && field.required && !field.value.trim()
        ? '请填写此字段。'
        : ''
    if (message) errors.value = { ...errors.value, [field.id]: message }
    else {
      const next = { ...errors.value }
      delete next[field.id]
      errors.value = next
    }
    return !message
  }

  const validateForm = (form?: HTMLFormElement | null) => {
    if (!form) return false
    let firstInvalid: HTMLInputElement | undefined
    for (const field of form.querySelectorAll<HTMLInputElement>('input[id]')) {
      if (!validateField(field) && !firstInvalid) firstInvalid = field
    }
    firstInvalid?.focus({ preventScroll: false })
    return !firstInvalid
  }

  const revalidateInput = (event: Event) => {
    const input = event.target
    if (input instanceof HTMLInputElement && errors.value[input.id]) validateField(input)
  }

  const setFieldError = (field: HTMLInputElement | null | undefined, message: string) => {
    if (!field) return
    errors.value = { ...errors.value, [field.id]: message }
    field.focus()
  }

  const clearErrors = () => {
    errors.value = {}
  }

  return { errors, validateField, validateForm, revalidateInput, setFieldError, clearErrors }
}
