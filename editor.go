package main

import (
	"errors"
	"os/exec"
	"strconv"
	"strings"
)

// splitCommandLine splits a command line into arguments. Double and single
// quotes group words; backslashes are kept literally (Windows paths).
func splitCommandLine(s string) ([]string, error) {
	var args []string
	var cur strings.Builder
	inArg := false
	var quote rune
	for _, r := range s {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote = r
			inArg = true
		case r == ' ' || r == '\t':
			if inArg {
				args = append(args, cur.String())
				cur.Reset()
				inArg = false
			}
		default:
			cur.WriteRune(r)
			inArg = true
		}
	}
	if quote != 0 {
		return nil, errors.New("unterminated quote in editor command")
	}
	if inArg {
		args = append(args, cur.String())
	}
	return args, nil
}

// editorArgs expands an editor command template. {file} and {line} are
// replaced; when {file} does not appear the file is appended.
func editorArgs(template, file string, line int) ([]string, error) {
	args, err := splitCommandLine(template)
	if err != nil {
		return nil, err
	}
	if len(args) == 0 {
		return nil, errors.New("editor command is empty")
	}
	if line < 1 {
		line = 1
	}
	hasFile := false
	for i, a := range args {
		if strings.Contains(a, "{file}") {
			hasFile = true
		}
		a = strings.ReplaceAll(a, "{file}", file)
		a = strings.ReplaceAll(a, "{line}", strconv.Itoa(line))
		args[i] = a
	}
	if !hasFile {
		args = append(args, file)
	}
	return args, nil
}

func launchEditor(template, file string, line int) error {
	args, err := editorArgs(template, file, line)
	if err != nil {
		return err
	}
	cmd := exec.Command(args[0], args[1:]...)
	hideConsole(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
