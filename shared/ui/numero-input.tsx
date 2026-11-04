"use client";

/**
 * The input for every quantity, price or amount the user types: it shows es-AR thousands dots as they type
 * ("1.234.567,5"), display only. A typed "." (or the numpad's) is the decimal comma; deleting a grouping dot deletes
 * the digit next to it. The value never carries those dots: `onValueChange` receives it without them and, inside a
 * form, the submitted FormData entry is cleaned on the form's `formdata` event, so every parser keeps reading what it
 * read before (`interpretarNumero`). Pure rules: shared/decimal/numero-en-edicion.ts.
 *
 * Controlled (`value` + `onValueChange`, the value without dots) or uncontrolled (`defaultValue` + `name`).
 */
import { useEffect, useEffectEvent, useRef, type ChangeEvent, type ClipboardEvent, type ComponentProps } from "react";
import {
  agruparMiles,
  esNumeroEnEdicion,
  numeroParaEdicion,
  posicionTrasSignificativos,
  quitarMiles,
  significativosAntes,
  textoPegado,
} from "@/shared/decimal/numero-en-edicion";

export type NumeroInputProps = Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange" | "onPaste"> & {
  /** Controlled value, without grouping dots ("1234,5" or a canonical "1234.5"). */
  value?: string;
  defaultValue?: string | null;
  /** The new value without grouping dots, on every edit. */
  onValueChange?: (valor: string) => void;
};

export function NumeroInput({ value, defaultValue, onValueChange, ref, inputMode = "decimal", autoComplete = "off", ...props }: NumeroInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { name } = props;

  const aplicar = (input: HTMLInputElement, texto: string, caret: number) => {
    const nuevo = agruparMiles(texto);
    const posicion = nuevo === texto ? caret : posicionTrasSignificativos(nuevo, significativosAntes(texto, caret));
    if (input.value !== nuevo) input.value = nuevo;
    if (document.activeElement === input) input.setSelectionRange(posicion, posicion);
    onValueChange?.(quitarMiles(nuevo));
  };

  /** An edit made by hand (the default was prevented): apply it and let native "input" listeners (field-errors) see it. */
  const aplicarManual = (input: HTMLInputElement, texto: string, caret: number) => {
    aplicar(input, texto, caret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const onBeforeInput = useEffectEvent((event: InputEvent) => {
    const input = inputRef.current;
    if (!input || input.readOnly || input.disabled || !esNumeroEnEdicion(input.value)) return;
    const texto = input.value;
    const inicio = input.selectionStart ?? texto.length;
    const fin = input.selectionEnd ?? inicio;
    if (inicio !== fin) return;
    if (event.inputType === "deleteContentBackward" && inicio >= 2 && texto[inicio - 1] === ".") {
      event.preventDefault();
      aplicarManual(input, texto.slice(0, inicio - 2) + texto.slice(inicio), inicio - 2);
    } else if (event.inputType === "deleteContentForward" && texto[inicio] === ".") {
      event.preventDefault();
      aplicarManual(input, texto.slice(0, inicio) + texto.slice(inicio + 2), inicio);
    }
  });

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const listener = (event: Event) => onBeforeInput(event as InputEvent);
    input.addEventListener("beforeinput", listener);
    return () => input.removeEventListener("beforeinput", listener);
  }, []);

  // The submitted value never carries the grouping dots.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form || !name) return;
    const onFormData = (event: FormDataEvent) => {
      const valores = event.formData.getAll(name);
      if (!valores.some((v) => typeof v === "string" && v !== quitarMiles(v))) return;
      event.formData.delete(name);
      for (const v of valores) event.formData.append(name, typeof v === "string" ? quitarMiles(v) : v);
    };
    form.addEventListener("formdata", onFormData);
    return () => form.removeEventListener("formdata", onFormData);
  }, [name]);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    let texto = input.value;
    let caret = input.selectionStart ?? texto.length;
    // A typed "." or "," is the decimal comma. Handled here, after the fact, and not on "beforeinput": composition
    // keyboards (Android) fire a beforeinput that cannot be cancelled, and a dot left in would read as thousands (1.3 -> 13).
    const nativo = event.nativeEvent as InputEvent;
    const separador = texto[caret - 1];
    if ((nativo.inputType === "insertText" || nativo.inputType === "insertCompositionText") && (separador === "." || separador === ",") && nativo.data?.endsWith(separador)) {
      const antes = texto.slice(0, caret - 1);
      const despues = texto.slice(caret);
      if (esNumeroEnEdicion(antes + despues)) {
        if ((antes + despues).includes(",")) {
          texto = antes + despues; // Already has its decimal comma: the second one is dropped.
          caret -= 1;
        } else {
          texto = `${antes},${despues}`;
        }
      }
    }
    aplicar(input, texto, caret);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const pegado = event.clipboardData.getData("text");
    if (!pegado || input.readOnly || input.disabled || !esNumeroEnEdicion(input.value)) return;
    event.preventDefault();
    const insertado = textoPegado(pegado);
    const inicio = input.selectionStart ?? input.value.length;
    const fin = input.selectionEnd ?? inicio;
    aplicarManual(input, input.value.slice(0, inicio) + insertado + input.value.slice(fin), inicio + insertado.length);
  };

  const setRef = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const valor = value === undefined ? { defaultValue: numeroParaEdicion(defaultValue) } : { value: numeroParaEdicion(value) };
  return <input {...props} {...valor} ref={setRef} type="text" inputMode={inputMode} autoComplete={autoComplete} onChange={onChange} onPaste={onPaste} />;
}
